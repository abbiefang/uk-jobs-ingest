import type { CompanyRow, Fetcher, FetchOutcome, JobRecord } from "./types";
import { requireEnv, sb } from "./lib/supabase";
import { rateLimiter } from "./lib/http";
import { chunk, dedupeByExternalId, planDeactivations, splitUpsertRows } from "./lib/store";
import { normalizeCompany } from "./lib/companies";
import { fetchGreenhouse } from "./fetchers/greenhouse";
import { fetchLever } from "./fetchers/lever";
import { fetchAshby } from "./fetchers/ashby";
import { fetchWorkable } from "./fetchers/workable";
import { fetchSmartRecruiters } from "./fetchers/smartrecruiters";
import { fetchRecruitee } from "./fetchers/recruitee";
import { fetchTeamtailor } from "./fetchers/teamtailor";

const FETCHERS: Record<string, Fetcher> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
  smartrecruiters: fetchSmartRecruiters,
  recruitee: fetchRecruitee,
  teamtailor: fetchTeamtailor,
};

type AtsStats = {
  ats: string;
  companiesFetched: number;
  jobsUpserted: number;
  jobsDeactivated: number;
  failures: number;
  writeErrors: number;
  durationMs: number;
  ok: boolean;
};

const COMPANIES_PAGE_SIZE = 1000;

/** Unlike a single company's job list, the full ingest_companies directory can exceed
 *  PostgREST's default 1000-row response cap — paginate with Range headers until a short
 *  page confirms there's nothing left. Polls both 'active' and 'empty' companies (an empty
 *  board is a valid steady state that still needs to keep being checked; only 'dead' is
 *  excluded — that status transition is Task 7's job, not this one's). */
async function fetchCompanies(): Promise<CompanyRow[]> {
  const all: CompanyRow[] = [];
  let offset = 0;
  while (true) {
    const res = await sb(
      "ingest_companies?status=in.(active,empty)&select=slug,ats,company_name,careers_url,sponsor_matched,status,consecutive_failures",
      { headers: { Range: `${offset}-${offset + COMPANIES_PAGE_SIZE - 1}`, "Range-Unit": "items" } },
    );
    const page = Array.isArray(res.body) ? (res.body as CompanyRow[]) : [];
    all.push(...page);
    if (page.length < COMPANIES_PAGE_SIZE) break;
    offset += COMPANIES_PAGE_SIZE;
  }
  return all;
}

async function processAtsGroup(ats: string, companies: CompanyRow[]): Promise<AtsStats> {
  const start = Date.now();
  const limiter = rateLimiter(1100);
  const fetcher = FETCHERS[ats];

  let companiesFetched = 0;
  let jobsUpserted = 0;
  let jobsDeactivated = 0;
  let failures = 0;
  let writeErrors = 0;

  // Every DB write in this group goes through here so a non-2xx response or a thrown
  // network/timeout error is counted exactly once instead of being silently absorbed.
  async function write(path: string, init: RequestInit & { prefer?: string }): Promise<boolean> {
    try {
      const res = await sb(path, init);
      if (res.status >= 200 && res.status < 300) return true;
      writeErrors++;
      return false;
    } catch {
      writeErrors++;
      return false;
    }
  }

  // Upserts one company's already-deduped jobs in chunks of 500, splitting each chunk into up
  // to two requests via splitUpsertRows — PostgREST requires uniform columns per request body,
  // and a "touch" row (SmartRecruiters known-job sentinel) omits different keys than a full row.
  async function upsertJobs(jobs: JobRecord[]): Promise<number> {
    let upserted = 0;
    for (const group of chunk(jobs, 500)) {
      const rows = group.map((job) => ({
        ...job,
        sponsor_norm: normalizeCompany(job.company_name),
        last_seen_at: new Date().toISOString(),
        is_active: true,
      }));
      const { full, touch } = splitUpsertRows(rows);
      for (const batch of [full, touch]) {
        if (batch.length === 0) continue;
        const ok = await write("ingested_jobs?on_conflict=ats,external_id", {
          method: "POST",
          prefer: "resolution=merge-duplicates",
          body: JSON.stringify(batch),
        });
        if (ok) upserted += batch.length;
      }
    }
    return upserted;
  }

  for (const company of companies) {
    companiesFetched++;
    try {
      if (!fetcher) {
        // Unknown ats — a data problem in ingest_companies, not something this run caused.
        // Count it as a failure for this company and move on rather than crashing the group.
        failures++;
        await write(
          `ingest_companies?ats=eq.${encodeURIComponent(ats)}&slug=eq.${encodeURIComponent(company.slug)}`,
          { method: "PATCH", body: JSON.stringify({ consecutive_failures: company.consecutive_failures + 1 }) },
        );
        continue;
      }

      // PostgREST's default row cap is 1000; a single company's active jobs won't reach that
      // in practice, so no Range-header pagination here (unlike fetchCompanies above).
      const existingRes = await sb(
        `ingested_jobs?ats=eq.${encodeURIComponent(ats)}&company_slug=eq.${encodeURIComponent(company.slug)}&is_active=eq.true&select=id,external_id`,
      );
      const existing = Array.isArray(existingRes.body)
        ? (existingRes.body as { id: number; external_id: string }[])
        : [];
      const existingIds = new Set(existing.map((row) => row.external_id));

      // Gate once per company, right before the external ATS call — rateLimiter paces requests
      // to the ATS host, not to our own Supabase project. fetchSmartRecruiters makes 1 listing
      // call plus up to N detail calls per company with no pacing of its own; that internal
      // burst is accepted because N is bounded to jobs absent from existingIds (known jobs skip
      // the detail call), so gating once here is enough to stay polite across companies.
      await limiter();

      let outcome: FetchOutcome;
      try {
        outcome = await fetcher(company, { existingIds });
      } catch {
        // A fetcher throwing (vs. returning ok:false) is unexpected — fetchJson already
        // normalizes network/timeout failures into a status it can branch on — but treat it
        // the same as a reported failure rather than letting it fall through to the outer
        // catch and skip this company's bookkeeping PATCH.
        outcome = { ok: false, error: "fetcher threw" };
      }

      if (!outcome.ok) {
        failures++;
        // Outage ≠ empty board: never deactivate this company's rows on a failed fetch.
        await write(
          `ingest_companies?ats=eq.${encodeURIComponent(ats)}&slug=eq.${encodeURIComponent(company.slug)}`,
          { method: "PATCH", body: JSON.stringify({ consecutive_failures: company.consecutive_failures + 1 }) },
        );
        continue;
      }

      // Dedupe once and reuse for both the upsert and the deactivation's fetched-id set — a
      // fetcher returning the same posting twice (SmartRecruiters' offset paging can overlap)
      // would otherwise make PostgREST reject the whole upsert batch.
      const jobs = dedupeByExternalId(outcome.jobs);
      jobsUpserted += await upsertJobs(jobs);

      const idsToDeactivate = planDeactivations(existing, new Set(jobs.map((j) => j.external_id)));
      for (const idChunk of chunk(idsToDeactivate, 100)) {
        const ok = await write(`ingested_jobs?id=in.(${idChunk.join(",")})`, {
          method: "PATCH",
          body: JSON.stringify({ is_active: false }),
        });
        if (ok) jobsDeactivated += idChunk.length;
      }

      await write(
        `ingest_companies?ats=eq.${encodeURIComponent(ats)}&slug=eq.${encodeURIComponent(company.slug)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: jobs.length === 0 ? "empty" : "active",
            consecutive_failures: 0,
            last_ok_at: new Date().toISOString(),
          }),
        },
      );
    } catch {
      // Last-resort net: an unexpected throw anywhere in this company's processing (a network
      // abort not already normalized by fetchJson/sb, or any other bug) must not tear down the
      // other companies in this group or the other 6 groups in main()'s Promise.all.
      failures++;
    }
  }

  const durationMs = Date.now() - start;
  const ok = failures < companiesFetched && writeErrors === 0;

  await write("job_ingest_runs", {
    method: "POST",
    body: JSON.stringify({
      run_started_at: new Date(start).toISOString(),
      ats,
      companies_fetched: companiesFetched,
      jobs_upserted: jobsUpserted,
      jobs_deactivated: jobsDeactivated,
      failures,
      duration_ms: durationMs,
      ok,
    }),
  });

  return { ats, companiesFetched, jobsUpserted, jobsDeactivated, failures, writeErrors, durationMs, ok };
}

async function main() {
  requireEnv();

  const companies = await fetchCompanies();

  const byAts = new Map<string, CompanyRow[]>();
  for (const company of companies) {
    const group = byAts.get(company.ats);
    if (group) group.push(company);
    else byAts.set(company.ats, [company]);
  }

  const results = await Promise.all(
    [...byAts.entries()].map(([ats, group]) =>
      // Outermost net: processAtsGroup already catches per-company, so this should be
      // unreachable, but one group throwing must not reject the others via Promise.all.
      processAtsGroup(ats, group).catch(
        (): AtsStats => ({
          ats,
          companiesFetched: group.length,
          jobsUpserted: 0,
          jobsDeactivated: 0,
          failures: group.length,
          writeErrors: 0,
          durationMs: 0,
          ok: false,
        }),
      ),
    ),
  );

  const totalUpserted = results.reduce((sum, r) => sum + r.jobsUpserted, 0);
  const allFailed = results.length > 0 && results.every((r) => !r.ok);

  // LOG HYGIENE: public Actions logs are world-readable — aggregate counts only, never a
  // company name, slug, or per-company error string.
  console.log(JSON.stringify({ runs: results, totalUpserted, polledCompanies: companies.length }));

  if (allFailed || (totalUpserted === 0 && companies.length > 0)) {
    process.exitCode = 1;
  }
}

main();

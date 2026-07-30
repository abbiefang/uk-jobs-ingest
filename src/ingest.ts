import type { CompanyRow, Fetcher, JobRecord } from "./types";
import { requireEnv, sb } from "./lib/supabase";
import { rateLimiter } from "./lib/http";
import { chunk, planDeactivations } from "./lib/store";
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
  durationMs: number;
  ok: boolean;
};

/** Upserts one company's jobs in chunks of 500, splitting each chunk into up to two
 *  requests: PostgREST requires uniform columns per request body, and a row whose
 *  description_text is "" (the SmartRecruiters known-job sentinel) must omit that key
 *  entirely so the merge keeps the previously stored description instead of blanking it. */
async function upsertJobs(jobs: JobRecord[]): Promise<number> {
  let upserted = 0;
  for (const group of chunk(jobs, 500)) {
    const fullRows: Record<string, unknown>[] = [];
    const keepStoredDescriptionRows: Record<string, unknown>[] = [];
    for (const job of group) {
      const row: Record<string, unknown> = {
        ...job,
        sponsor_norm: normalizeCompany(job.company_name),
        last_seen_at: new Date().toISOString(),
        is_active: true,
      };
      if (job.description_text === "") {
        delete row.description_text;
        keepStoredDescriptionRows.push(row);
      } else {
        fullRows.push(row);
      }
    }
    for (const rows of [fullRows, keepStoredDescriptionRows]) {
      if (rows.length === 0) continue;
      const res = await sb("ingested_jobs?on_conflict=ats,external_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates",
        body: JSON.stringify(rows),
      });
      if (res.status >= 200 && res.status < 300) upserted += rows.length;
    }
  }
  return upserted;
}

async function processAtsGroup(ats: string, companies: CompanyRow[]): Promise<AtsStats> {
  const start = Date.now();
  const limiter = rateLimiter(1100);
  const fetcher = FETCHERS[ats];

  let companiesFetched = 0;
  let jobsUpserted = 0;
  let jobsDeactivated = 0;
  let failures = 0;

  for (const company of companies) {
    companiesFetched++;

    // PostgREST's default row cap is 1000; a single company's active jobs won't reach that
    // in practice, so no Range-header pagination here.
    const existingRes = await sb(
      `ingested_jobs?ats=eq.${ats}&company_slug=eq.${company.slug}&is_active=eq.true&select=id,external_id`,
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
    const outcome = await fetcher(company, { existingIds });

    if (!outcome.ok) {
      failures++;
      // Outage ≠ empty board: never deactivate this company's rows on a failed fetch.
      await sb(`ingest_companies?ats=eq.${ats}&slug=eq.${company.slug}`, {
        method: "PATCH",
        body: JSON.stringify({ consecutive_failures: company.consecutive_failures + 1 }),
      });
      continue;
    }

    jobsUpserted += await upsertJobs(outcome.jobs);

    const idsToDeactivate = planDeactivations(existing, new Set(outcome.jobs.map((j) => j.external_id)));
    for (const idChunk of chunk(idsToDeactivate, 100)) {
      const res = await sb(`ingested_jobs?id=in.(${idChunk.join(",")})`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: false }),
      });
      if (res.status >= 200 && res.status < 300) jobsDeactivated += idChunk.length;
    }

    await sb(`ingest_companies?ats=eq.${ats}&slug=eq.${company.slug}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: outcome.jobs.length === 0 ? "empty" : "active",
        consecutive_failures: 0,
        last_ok_at: new Date().toISOString(),
      }),
    });
  }

  const durationMs = Date.now() - start;
  const ok = failures < companiesFetched;

  await sb("job_ingest_runs", {
    method: "POST",
    body: JSON.stringify({
      ats,
      companies_fetched: companiesFetched,
      jobs_upserted: jobsUpserted,
      jobs_deactivated: jobsDeactivated,
      failures,
      duration_ms: durationMs,
      ok,
    }),
  });

  return { ats, companiesFetched, jobsUpserted, jobsDeactivated, failures, durationMs, ok };
}

async function main() {
  requireEnv();

  const res = await sb(
    "ingest_companies?status=eq.active&select=slug,ats,company_name,careers_url,sponsor_matched,status,consecutive_failures",
  );
  const companies = Array.isArray(res.body) ? (res.body as CompanyRow[]) : [];

  const byAts = new Map<string, CompanyRow[]>();
  for (const company of companies) {
    const group = byAts.get(company.ats);
    if (group) group.push(company);
    else byAts.set(company.ats, [company]);
  }

  const results = await Promise.all(
    [...byAts.entries()].map(([ats, group]) => processAtsGroup(ats, group)),
  );

  const totalUpserted = results.reduce((sum, r) => sum + r.jobsUpserted, 0);
  const allFailed = results.length > 0 && results.every((r) => !r.ok);

  // LOG HYGIENE: public Actions logs are world-readable — aggregate counts only, never a
  // company name, slug, or per-company error string.
  console.log(JSON.stringify({ runs: results, totalUpserted, activeCompanies: companies.length }));

  if (allFailed || (totalUpserted === 0 && companies.length > 0)) {
    process.exit(1);
  }
}

main();

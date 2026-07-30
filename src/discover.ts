import { requireEnv, sb } from "./lib/supabase";
import { fetchJson, rateLimiter } from "./lib/http";
import { chunk, isSuccessfulPage } from "./lib/store";
import { normalizeCompany, parseCsvLine, slugVariants } from "./lib/companies";

const UA = "uk-jobs-ingest/1.0 (+github.com/abbiefang/uk-jobs-ingest)";
const REGISTER_PAGE_URL =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";
const ATS_COMPANIES_API =
  "https://api.github.com/repos/kalil0321/ats-scrapers/contents/ats-companies";
const PROBE_BUDGET = 1500;
const RETENTION_DAYS = 60;

const ATS_LIST = ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee", "teamtailor"] as const;
type Ats = (typeof ATS_LIST)[number];

type SeedRow = { name: string; ats: string; slug: string };

function teamtailorCareersUrl(ats: string, slug: string): string | null {
  return ats === "teamtailor" ? `https://${slug}.teamtailor.com` : null;
}

// A/B failures are third-party (gov.uk, GitHub) and must abort the whole run before any cursor
// write — carry only a fixed, non-sensitive reason code so main()'s error log never risks
// leaking response bodies (LOG HYGIENE applies to error paths too, not just the happy-path
// aggregate).
class RegisterFetchError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}
class DirectoryFetchError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

// ---------------------------------------------------------------------------
// A. Sponsor register
// ---------------------------------------------------------------------------

async function fetchRegisterCsvUrl(): Promise<string> {
  const res = await fetch(REGISTER_PAGE_URL, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new RegisterFetchError("gov_uk_page_failed");
  const html = await res.text();
  const match = html.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"'\s)]+\.csv/);
  if (!match) throw new RegisterFetchError("csv_url_not_found");
  return match[0];
}

async function fetchRegisterCsvText(csvUrl: string): Promise<string> {
  const res = await fetch(csvUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new RegisterFetchError("csv_download_failed");
  return res.text();
}

function parseRegisterCsv(csvText: string): {
  registerMap: Map<string, string>;
  totalRows: number;
  skilledWorkerRows: number;
} {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { registerMap: new Map(), totalRows: 0, skilledWorkerRows: 0 };

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("organisation name");
  const routeIdx = header.indexOf("route");
  if (nameIdx === -1 || routeIdx === -1) throw new RegisterFetchError("missing_csv_headers");

  const registerMap = new Map<string, string>();
  let skilledWorkerRows = 0;
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const name = fields[nameIdx]?.trim();
    const route = fields[routeIdx] ?? "";
    if (!name || !route.includes("Skilled Worker")) continue;
    skilledWorkerRows++;
    const key = normalizeCompany(name);
    if (key && !registerMap.has(key)) registerMap.set(key, name);
  }
  return { registerMap, totalRows: lines.length - 1, skilledWorkerRows };
}

async function buildRegister() {
  const csvUrl = await fetchRegisterCsvUrl();
  const csvText = await fetchRegisterCsvText(csvUrl);
  return parseRegisterCsv(csvText);
}

// ---------------------------------------------------------------------------
// B. Known-slug seed (kalil0321/ats-scrapers directory)
// ---------------------------------------------------------------------------

function normalizeAts(raw: string): Ats | null {
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  return (ATS_LIST as readonly string[]).includes(key) ? (key as Ats) : null;
}

function findHeaderIndex(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

function deriveSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0 && !["jobs", "embed", "v1", "v0"].includes(pathParts[0])) {
      return pathParts[0].toLowerCase();
    }
    const sub = u.hostname.split(".")[0];
    if (sub && !["www", "api", "boards", "jobs", "apply"].includes(sub)) return sub.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

/** Header is inspected at runtime — the upstream repo's CSV schema isn't ours to pin down. */
function parseAtsCompaniesCsv(csvText: string): { name: string; ats: Ats; slug: string }[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const nameIdx = findHeaderIndex(header, ["company", "company name", "name"]);
  const atsIdx = findHeaderIndex(header, ["ats", "ats_name", "provider"]);
  const slugIdx = findHeaderIndex(header, ["slug", "board_slug", "company_slug"]);
  const urlIdx = findHeaderIndex(header, ["url", "careers_url", "board_url", "link"]);
  if (nameIdx === -1 || atsIdx === -1) return [];

  const rows: { name: string; ats: Ats; slug: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const name = fields[nameIdx]?.trim();
    const atsRaw = fields[atsIdx]?.trim();
    if (!name || !atsRaw) continue;
    const ats = normalizeAts(atsRaw);
    if (!ats) continue;
    let slug = (slugIdx !== -1 ? fields[slugIdx]?.trim() : "") ?? "";
    if (!slug && urlIdx !== -1) slug = deriveSlugFromUrl(fields[urlIdx]?.trim() ?? "") ?? "";
    slug = slug.toLowerCase();
    if (!slug) continue;
    rows.push({ name, ats, slug });
  }
  return rows;
}

async function fetchAtsCompaniesDirectory(): Promise<{ name: string; download_url: string }[]> {
  const res = await fetch(ATS_COMPANIES_API, {
    headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new DirectoryFetchError("github_api_failed");
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new DirectoryFetchError("github_api_bad_json");
  }
  if (!Array.isArray(body)) throw new DirectoryFetchError("github_api_bad_body");
  return body
    .filter((e): e is { name: string; download_url: string } => {
      if (!e || typeof e !== "object") return false;
      const rec = e as Record<string, unknown>;
      return typeof rec.name === "string" && rec.name.endsWith(".csv") && typeof rec.download_url === "string";
    })
    .map((e) => ({ name: e.name, download_url: e.download_url }));
}

async function loadAlwaysIncludeKeys(): Promise<Set<string>> {
  try {
    // @ts-expect-error seed-companies.ts is created by Task 8; absent until then.
    const mod = (await import("./seed-companies.js")) as { SEED?: SeedRow[] };
    const seed = Array.isArray(mod.SEED) ? mod.SEED : [];
    return new Set(seed.map((s) => `${s.ats}::${s.slug}`));
  } catch {
    // Task 8 hasn't created seed-companies.ts yet — no always-include rows this run.
    return new Set();
  }
}

async function upsertCompanies(rows: Record<string, unknown>[]): Promise<number> {
  let upserted = 0;
  for (const group of chunk(rows, 500)) {
    if (group.length === 0) continue;
    const res = await sb("ingest_companies?on_conflict=ats,slug", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: JSON.stringify(group),
    });
    if (res.status >= 200 && res.status < 300) upserted += group.length;
  }
  return upserted;
}

async function buildDirectorySeed(registerMap: Map<string, string>): Promise<{ scanned: number; upserted: number }> {
  const files = await fetchAtsCompaniesDirectory();
  const alwaysInclude = await loadAlwaysIncludeKeys();

  let scanned = 0;
  let upserted = 0;
  for (const file of files) {
    const csvRes = await fetch(file.download_url, { signal: AbortSignal.timeout(30_000) });
    if (!csvRes.ok) continue; // one bad file in the directory shouldn't kill the whole seed step
    const rows = parseAtsCompaniesCsv(await csvRes.text());
    scanned += rows.length;

    const toUpsert: Record<string, unknown>[] = [];
    for (const row of rows) {
      const sponsorMatched = registerMap.has(normalizeCompany(row.name));
      if (!sponsorMatched && !alwaysInclude.has(`${row.ats}::${row.slug}`)) continue;
      toUpsert.push({
        slug: row.slug,
        ats: row.ats,
        company_name: row.name,
        careers_url: teamtailorCareersUrl(row.ats, row.slug),
        sponsor_matched: sponsorMatched,
        status: "active",
        consecutive_failures: 0,
      });
    }
    upserted += await upsertCompanies(toUpsert);
  }
  return { scanned, upserted };
}

// ---------------------------------------------------------------------------
// C. Probe budget
// ---------------------------------------------------------------------------

async function fetchExistingCompanyIdentity(): Promise<{ pairs: Set<string>; names: Set<string> }> {
  const pairs = new Set<string>();
  const names = new Set<string>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const res = await sb("ingest_companies?select=ats,slug,company_name", {
      headers: { Range: `${offset}-${offset + PAGE - 1}`, "Range-Unit": "items" },
    });
    if (!isSuccessfulPage(res.status, res.body)) throw new DirectoryFetchError("ingest_companies_read_failed");
    const page = res.body as { ats: string; slug: string; company_name: string }[];
    for (const row of page) {
      pairs.add(`${row.ats}::${row.slug}`);
      names.add(normalizeCompany(row.company_name));
    }
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return { pairs, names };
}

async function readCursor(): Promise<number> {
  const res = await sb("ingest_state?key=eq.discover_cursor&select=value");
  if (Array.isArray(res.body) && res.body.length > 0) {
    const offset = (res.body[0] as { value?: { offset?: unknown } })?.value?.offset;
    if (typeof offset === "number" && Number.isFinite(offset) && offset >= 0) return offset;
  }
  return 0;
}

async function writeCursor(offset: number): Promise<void> {
  await sb("ingest_state?on_conflict=key", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: JSON.stringify([{ key: "discover_cursor", value: { offset } }]),
  });
}

/** Alphabetical-by-normalized-name window of `size` register entries not already covered by an
 *  existing ingest_companies row (by name match), starting at `offset` and wrapping around the
 *  candidate list rather than the full register — so the cursor always lands on a real,
 *  not-yet-covered candidate next run instead of drifting into already-covered territory. */
function selectProbeBatch(
  registerMap: Map<string, string>,
  existingNames: Set<string>,
  cursorOffset: number,
  size: number,
): { batch: { normalized: string; name: string }[]; nextOffset: number } {
  const candidates = [...registerMap.entries()]
    .filter(([norm]) => !existingNames.has(norm))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([normalized, name]) => ({ normalized, name }));

  if (candidates.length === 0) return { batch: [], nextOffset: 0 };

  const start = cursorOffset % candidates.length;
  const n = Math.min(size, candidates.length);
  const batch = Array.from({ length: n }, (_, i) => candidates[(start + i) % candidates.length]);
  return { batch, nextOffset: (start + n) % candidates.length };
}

const PROBE_HOSTS: { ats: Exclude<Ats, "teamtailor">; probe: (slug: string, limiter: () => Promise<void>) => Promise<boolean> }[] = [
  {
    ats: "greenhouse",
    probe: async (slug, limiter) => {
      await limiter();
      const r = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
      return r.status === 200;
    },
  },
  {
    ats: "lever",
    probe: async (slug, limiter) => {
      await limiter();
      const r = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`);
      return r.status === 200;
    },
  },
  {
    ats: "ashby",
    probe: async (slug, limiter) => {
      await limiter();
      const r = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      return r.status === 200;
    },
  },
  {
    ats: "workable",
    probe: async (slug, limiter) => {
      await limiter();
      const r = await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
      if (r.status !== 200) return false;
      const jobs = (r.body as { jobs?: unknown })?.jobs;
      return Array.isArray(jobs) && jobs.length > 0;
    },
  },
  {
    ats: "smartrecruiters",
    probe: async (slug, limiter) => {
      await limiter();
      const r = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`);
      if (r.status !== 200) return false;
      const totalFound = (r.body as { totalFound?: unknown })?.totalFound;
      return typeof totalFound === "number" && totalFound > 0;
    },
  },
  {
    ats: "recruitee",
    probe: async (slug, limiter) => {
      await limiter();
      const r = await fetchJson(`https://${slug}.recruitee.com/api/offers/`);
      return r.status === 200;
    },
  },
];

/** One independent rate limiter per host so a burst of variants for one company never exceeds
 *  1 req/s against any single ATS host, while different hosts are paced independently. */
function makeProbeLimiters(): Record<string, () => Promise<void>> {
  const limiters: Record<string, () => Promise<void>> = {};
  for (const { ats } of PROBE_HOSTS) limiters[ats] = rateLimiter(1100);
  return limiters;
}

/** Tries each slug variant against all 6 hosts in parallel (each host paced by its own limiter);
 *  stops at the first hit. Probing hosts in parallel per variant — rather than fully serial —
 *  keeps the whole probe phase bounded by ~variant-count round trips per name instead of
 *  variant-count × host-count, which matters at a 1,500-name-per-run budget. */
async function probeCompanyName(
  name: string,
  limiters: Record<string, () => Promise<void>>,
): Promise<{ ats: string; slug: string } | null> {
  for (const variant of slugVariants(name)) {
    const results = await Promise.all(
      PROBE_HOSTS.map(async ({ ats, probe }) => ({ ats, hit: await probe(variant, limiters[ats]) })),
    );
    const winner = results.find((r) => r.hit);
    if (winner) return { ats: winner.ats, slug: variant };
  }
  return null;
}

async function runProbeBudget(
  registerMap: Map<string, string>,
  existingNames: Set<string>,
  existingPairs: Set<string>,
): Promise<{ attempted: number; hits: number }> {
  const cursorOffset = await readCursor();
  const { batch, nextOffset } = selectProbeBatch(registerMap, existingNames, cursorOffset, PROBE_BUDGET);
  const limiters = makeProbeLimiters();

  let hits = 0;
  const toUpsert: Record<string, unknown>[] = [];
  for (const { name } of batch) {
    const result = await probeCompanyName(name, limiters);
    if (!result) continue;
    const key = `${result.ats}::${result.slug}`;
    if (existingPairs.has(key)) continue; // guards a race with a concurrent run/company add
    existingPairs.add(key);
    hits++;
    toUpsert.push({
      slug: result.slug,
      ats: result.ats,
      company_name: name,
      careers_url: teamtailorCareersUrl(result.ats, result.slug),
      sponsor_matched: true,
      status: "active",
      consecutive_failures: 0,
    });
  }

  await upsertCompanies(toUpsert);
  await writeCursor(nextOffset);
  return { attempted: batch.length, hits };
}

// ---------------------------------------------------------------------------
// D. Health
// ---------------------------------------------------------------------------

async function markDeadCompanies(): Promise<{ marked: number }> {
  const res = await sb("ingest_companies?consecutive_failures=gte.3&status=eq.active", {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({ status: "dead" }),
  });
  return { marked: Array.isArray(res.body) ? res.body.length : 0 };
}

// ---------------------------------------------------------------------------
// E. Retention
// ---------------------------------------------------------------------------

async function runRetention(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const res = await sb(`ingested_jobs?is_active=eq.false&last_seen_at=lt.${encodeURIComponent(cutoff)}`, {
    method: "DELETE",
    prefer: "return=representation",
  });
  return { deleted: Array.isArray(res.body) ? res.body.length : 0 };
}

// ---------------------------------------------------------------------------
// --seed mode
// ---------------------------------------------------------------------------

async function runSeedMode(): Promise<void> {
  let seed: SeedRow[];
  try {
    // @ts-expect-error seed-companies.ts is created by Task 8; absent until then.
    const mod = (await import("./seed-companies.js")) as { SEED?: SeedRow[] };
    if (!Array.isArray(mod.SEED)) throw new Error("SEED missing");
    seed = mod.SEED;
  } catch {
    console.log(JSON.stringify({ error: "seed_module_missing" }));
    process.exitCode = 1;
    return;
  }

  let registerMap: Map<string, string>;
  try {
    ({ registerMap } = await buildRegister());
  } catch (err) {
    const reason = err instanceof RegisterFetchError ? err.reason : "unknown";
    console.log(JSON.stringify({ error: "seed_register_fetch_failed", reason }));
    process.exitCode = 1;
    return;
  }

  const rows = seed.map((s) => ({
    slug: s.slug,
    ats: s.ats,
    company_name: s.name,
    careers_url: teamtailorCareersUrl(s.ats, s.slug),
    sponsor_matched: registerMap.has(normalizeCompany(s.name)),
    status: "active",
    consecutive_failures: 0,
  }));
  const upserted = await upsertCompanies(rows);

  console.log(JSON.stringify({ seedRows: seed.length, seedUpserted: upserted }));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  requireEnv();

  if (process.argv.includes("--seed")) {
    try {
      await runSeedMode();
    } catch {
      // runSeedMode() handles its own two expected failure modes (missing module, register
      // fetch) internally — this only catches the final upsertCompanies() -> sb() call throwing
      // on a transient network error, same rationale as the C/D/E guard below.
      console.log(JSON.stringify({ error: "seed_mode_failed" }));
      process.exitCode = 1;
    }
    return;
  }

  let registerMap: Map<string, string>;
  let skilledWorkerRows: number;
  try {
    const result = await buildRegister();
    registerMap = result.registerMap;
    skilledWorkerRows = result.skilledWorkerRows;
  } catch (err) {
    // A failed register fetch means the rest of the run has nothing trustworthy to key off of
    // (module B's sponsor_matched and module C's whole candidate list both derive from it) — abort
    // before anything writes, including the cursor.
    const reason = err instanceof RegisterFetchError ? err.reason : "unknown";
    console.log(JSON.stringify({ error: "register_fetch_failed", reason }));
    process.exitCode = 1;
    return;
  }

  let directoryScanned: number;
  let directoryUpserted: number;
  try {
    const result = await buildDirectorySeed(registerMap);
    directoryScanned = result.scanned;
    directoryUpserted = result.upserted;
  } catch (err) {
    const reason = err instanceof DirectoryFetchError ? err.reason : "unknown";
    console.log(JSON.stringify({ error: "directory_seed_failed", reason }));
    process.exitCode = 1;
    return;
  }

  let probeStats: { attempted: number; hits: number };
  let deadStats: { marked: number };
  let retentionStats: { deleted: number };
  try {
    const { pairs: existingPairs, names: existingNames } = await fetchExistingCompanyIdentity();
    probeStats = await runProbeBudget(registerMap, existingNames, existingPairs);
    deadStats = await markDeadCompanies();
    retentionStats = await runRetention();
  } catch {
    // Unlike A/B (third-party), C/D/E only talk to our own Supabase project via sb() — sb()
    // doesn't catch a thrown network error itself (same reason ingest.ts wraps every sb() call
    // in its own write() helper), so a transient blip here must not crash with a raw unhandled
    // rejection. C's own writeCursor() only runs after a successful probe batch, so this can't
    // land mid-way through writing a partial cursor.
    console.log(JSON.stringify({ error: "probe_health_retention_failed" }));
    process.exitCode = 1;
    return;
  }

  // LOG HYGIENE: aggregate counts only — never a company name, slug, or per-row detail.
  console.log(JSON.stringify({
    registerSize: registerMap.size,
    skilledWorkerRows,
    directoryCsvRowsScanned: directoryScanned,
    directoryHitsUpserted: directoryUpserted,
    probesAttempted: probeStats.attempted,
    probeHits: probeStats.hits,
    deadsMarked: deadStats.marked,
    retentionDeleted: retentionStats.deleted,
  }));
}

main();

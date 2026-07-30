import type { CompanyRow, Fetcher, JobRecord } from "../types";
import { fetchJson } from "../lib/http";
import { extractGbpRange, isUkLocation, stripHtml, ukCityOf } from "../lib/text";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function normalizeAshby(raw: unknown, company: CompanyRow): JobRecord | null {
  const j = rec(raw);
  const locationRaw = str(j.location);
  const secondaryLocs = arr(j.secondaryLocations);
  const allLocations = [
    locationRaw,
    ...secondaryLocs.map((l) => str(rec(l).location)),
  ].filter((s) => s);
  const joinedLocations = allLocations.join(" ");
  // Checked per-location, not on the joined string: isUkLocation's non-UK negative markers
  // (e.g. "barcelona", "paris") would otherwise veto a genuinely UK secondary location just
  // because an unrelated non-UK office name also appears somewhere in the joined text.
  if (!allLocations.some((loc) => isUkLocation(loc))) return null;
  const description = stripHtml(str(j.descriptionHtml)).slice(0, 5000);
  const compensation = rec(j.compensation);
  const compensationSummary = str(compensation.compensationTierSummary);
  let gbp = compensationSummary ? extractGbpRange(compensationSummary) : null;
  if (!gbp) gbp = extractGbpRange(description);
  const remote = bool(j.isRemote) ? ("remote" as const) : null;
  return {
    ats: "ashby",
    external_id: str(j.id),
    company_slug: company.slug,
    company_name: company.company_name,
    title: str(j.title),
    city: ukCityOf(joinedLocations),
    country_code: "GB",
    location_raw: joinedLocations,
    remote_type: remote,
    employment_type: null,
    salary_min: gbp?.min ?? null,
    salary_max: gbp?.max ?? null,
    salary_currency: gbp ? "GBP" : null,
    salary_raw: gbp ? `£${gbp.min}–£${gbp.max}` : null,
    description_text: description,
    apply_url: str(j.jobUrl) || str(j.applyUrl),
    posted_at: str(j.publishedAt) || null,
  };
}

export const fetchAshby: Fetcher = async (company) => {
  const r = await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${company.slug}?includeCompensation=true`,
  );
  if (r.status === 404) return { ok: false, error: "board 404", gone: true };
  if (r.status !== 200) return { ok: false, error: `http ${r.status}` };
  const jobs = arr(rec(r.body).jobs);
  if (!Array.isArray(jobs)) return { ok: false, error: "malformed body" };
  const out: JobRecord[] = [];
  for (const raw of jobs) {
    const j = normalizeAshby(raw, company);
    if (j && j.external_id && j.title && j.apply_url) out.push(j);
  }
  return { ok: true, jobs: out };
};

import type { CompanyRow, Fetcher, JobRecord } from "../types";
import { fetchJson } from "../lib/http";
import { extractGbpRange, isUkLocation, stripHtml, ukCityOf } from "../lib/text";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean => v === true;

export function normalizeWorkable(raw: unknown, company: CompanyRow): JobRecord | null {
  const j = rec(raw);
  const locationRaw = [str(j.city), str(j.country)].filter((s) => s).join(", ");
  if (!isUkLocation(locationRaw, str(j.country) || null)) return null;
  const description = stripHtml(str(j.description)).slice(0, 5000);
  const gbp = extractGbpRange(description);
  const remote = bool(j.telecommuting) ? ("hybrid" as const) : null;
  return {
    ats: "workable",
    external_id: str(j.shortcode),
    company_slug: company.slug,
    company_name: company.company_name,
    title: str(j.title),
    city: ukCityOf(locationRaw),
    country_code: "GB",
    location_raw: locationRaw,
    remote_type: remote,
    employment_type: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_raw: null,
    description_text: description,
    apply_url: str(j.application_url) || str(j.url),
    posted_at: str(j.published_on) ? `${str(j.published_on)}T00:00:00.000Z` : null,
  };
}

export const fetchWorkable: Fetcher = async (company) => {
  const r = await fetchJson(
    `https://apply.workable.com/api/v1/widget/accounts/${company.slug}?details=true`,
  );
  if (r.status === 404) return { ok: false, error: "board 404", gone: true };
  if (r.status !== 200) return { ok: false, error: `http ${r.status}` };
  const jobs = rec(r.body).jobs;
  if (!Array.isArray(jobs)) return { ok: false, error: "malformed body" };
  const out: JobRecord[] = [];
  for (const raw of jobs) {
    const j = normalizeWorkable(raw, company);
    if (j && j.external_id && j.title && j.apply_url) out.push(j);
  }
  return { ok: true, jobs: out };
};

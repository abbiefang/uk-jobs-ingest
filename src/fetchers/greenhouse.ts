import type { CompanyRow, Fetcher, JobRecord } from "../types";
import { fetchJson } from "../lib/http";
import { extractGbpRange, isUkLocation, stripHtml, ukCityOf } from "../lib/text";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function normalizeGreenhouse(raw: unknown, company: CompanyRow): JobRecord | null {
  const j = rec(raw);
  const locationRaw = str(rec(j.location).name);
  if (!isUkLocation(locationRaw)) return null;
  const description = stripHtml(str(j.content)).slice(0, 5000);
  const gbp = extractGbpRange(description);
  const remote = /remote/i.test(locationRaw) ? ("remote" as const) : null;
  return {
    ats: "greenhouse",
    external_id: String(j.id ?? ""),
    company_slug: company.slug,
    company_name: company.company_name,
    title: str(j.title),
    city: ukCityOf(locationRaw),
    country_code: "GB",
    location_raw: locationRaw,
    remote_type: remote,
    employment_type: null,
    salary_min: gbp?.min ?? null,
    salary_max: gbp?.max ?? null,
    salary_currency: gbp ? "GBP" : null,
    salary_raw: gbp ? `£${gbp.min}–£${gbp.max}` : null,
    description_text: description,
    apply_url: str(j.absolute_url),
    posted_at: str(j.first_published) || str(j.updated_at) || null,
  };
}

export const fetchGreenhouse: Fetcher = async (company) => {
  const r = await fetchJson(
    `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`,
  );
  if (r.status === 404) return { ok: false, error: "board 404", gone: true };
  if (r.status !== 200) return { ok: false, error: `http ${r.status}` };
  const jobs = rec(r.body).jobs;
  if (!Array.isArray(jobs)) return { ok: false, error: "malformed body" };
  const out: JobRecord[] = [];
  for (const raw of jobs) {
    const j = normalizeGreenhouse(raw, company);
    if (j && j.external_id && j.title && j.apply_url) out.push(j);
  }
  return { ok: true, jobs: out };
};

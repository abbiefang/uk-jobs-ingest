import type { CompanyRow, Fetcher, JobRecord } from "../types";
import { fetchJson } from "../lib/http";
import { isUkLocation, stripHtml, truncateText, ukCityOf } from "../lib/text";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function normalizeLever(raw: unknown, company: CompanyRow): JobRecord | null {
  const j = rec(raw);
  const cats = rec(j.categories);
  const locationRaw = str(cats.location) || str(j.country);
  if (!isUkLocation(locationRaw, str(j.country) || null)) return null;
  const salary = rec(j.salaryRange);
  const workplace = str(j.workplaceType).toLowerCase();
  const createdAt = num(j.createdAt);
  return {
    ats: "lever",
    external_id: str(j.id),
    company_slug: company.slug,
    company_name: company.company_name,
    title: str(j.text),
    city: ukCityOf(locationRaw),
    country_code: "GB",
    location_raw: locationRaw,
    remote_type: workplace === "remote" || workplace === "hybrid" || workplace === "onsite"
      ? (workplace as "remote" | "hybrid" | "onsite") : null,
    employment_type: str(cats.commitment) || null,
    salary_min: num(salary.min),
    salary_max: num(salary.max),
    salary_currency: str(salary.currency) || null,
    salary_raw: null,
    description_text: truncateText(stripHtml(str(j.descriptionPlain) || str(j.description)), 5000),
    apply_url: str(j.hostedUrl) || str(j.applyUrl),
    posted_at: createdAt ? new Date(createdAt).toISOString() : null,
  };
}

export const fetchLever: Fetcher = async (company) => {
  for (const host of ["https://api.lever.co", "https://api.eu.lever.co"]) {
    const r = await fetchJson(`${host}/v0/postings/${company.slug}?mode=json&limit=100`);
    if (r.status === 404) continue;
    if (r.status !== 200) return { ok: false, error: `http ${r.status}` };
    if (!Array.isArray(r.body)) return { ok: false, error: "malformed body" };
    const out: JobRecord[] = [];
    for (const raw of r.body) {
      const j = normalizeLever(raw, company);
      if (j && j.external_id && j.title && j.apply_url) out.push(j);
    }
    return { ok: true, jobs: out };
  }
  return { ok: false, error: "postings 404 on both hosts", gone: true };
};

import type { CompanyRow, Fetcher, JobRecord } from "../types";
import { fetchJson } from "../lib/http";
import { isUkLocation, stripHtml, truncateText, ukCityOf } from "../lib/text";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export function normalizeRecruitee(raw: unknown, company: CompanyRow): JobRecord | null {
  const j = rec(raw);
  const locationRaw = str(j.location) || str(j.city);
  if (!isUkLocation(locationRaw, str(j.country_code) || null)) return null;
  const salary = rec(j.salary);
  const description = truncateText(stripHtml(`${str(j.description)} ${str(j.requirements)}`), 5000);
  return {
    ats: "recruitee",
    external_id: String(j.id ?? ""),
    company_slug: company.slug,
    company_name: company.company_name,
    title: str(j.title),
    city: ukCityOf(locationRaw) || str(j.city) || null,
    country_code: "GB",
    location_raw: locationRaw,
    remote_type: bool(j.remote) ? "remote" : bool(j.hybrid) ? "hybrid" : bool(j.on_site) ? "onsite" : null,
    employment_type: str(j.employment_type_code) || null,
    salary_min: num(salary.min),
    salary_max: num(salary.max),
    salary_currency: str(salary.currency) || null,
    salary_raw: null,
    description_text: description,
    apply_url: str(j.careers_apply_url) || str(j.careers_url),
    posted_at: str(j.published_at) || str(j.created_at) || null,
  };
}

export const fetchRecruitee: Fetcher = async (company) => {
  const r = await fetchJson(`https://${company.slug}.recruitee.com/api/offers/`);
  if (r.status === 404) return { ok: false, error: "offers 404", gone: true };
  if (r.status !== 200) return { ok: false, error: `http ${r.status}` };
  const offers = rec(r.body).offers;
  if (!Array.isArray(offers)) return { ok: false, error: "malformed body" };
  const out: JobRecord[] = [];
  for (const raw of offers) {
    const j = normalizeRecruitee(raw, company);
    if (j && j.external_id && j.title && j.apply_url) out.push(j);
  }
  return { ok: true, jobs: out };
};

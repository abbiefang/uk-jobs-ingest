import type { CompanyRow, Fetcher, JobRecord } from "../types";
import { fetchJson } from "../lib/http";
import { extractGbpRange, isUkLocation, stripHtml, ukCityOf } from "../lib/text";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function ttLocation(jobposting: Rec): { locationRaw: string; isUk: boolean } {
  const addresses = arr(jobposting.jobLocation).map((l) => rec(rec(l).address));
  const localities = addresses.map((a) => str(a.addressLocality)).filter((s) => s);
  const isUk = addresses.some((a) => {
    const country = str(a.addressCountry);
    if (country) return country.toUpperCase() === "GB";
    return isUkLocation(str(a.addressLocality));
  });
  return { locationRaw: localities.join(", "), isUk };
}

function ttStructuredSalary(baseSalary: unknown): { min: number; max: number; currency: string | null } | null {
  if (typeof baseSalary === "number" && Number.isFinite(baseSalary)) {
    return { min: baseSalary, max: baseSalary, currency: null };
  }
  const b = rec(baseSalary);
  const currency = str(b.currency) || null;
  if (typeof b.value === "number" && Number.isFinite(b.value)) {
    return { min: b.value, max: b.value, currency };
  }
  const v = rec(b.value);
  const min = num(v.minValue);
  const max = num(v.maxValue);
  const single = num(v.value);
  if (min !== null || max !== null) return { min: min ?? max!, max: max ?? min!, currency };
  if (single !== null) return { min: single, max: single, currency };
  return null;
}

export function normalizeTeamtailor(raw: unknown, company: CompanyRow): JobRecord | null {
  const item = rec(raw);
  const jobposting = rec(item._jobposting);
  const { locationRaw, isUk } = ttLocation(jobposting);
  if (!isUk) return null;
  const description = stripHtml(str(item.content_html)).slice(0, 5000);
  const structured = ttStructuredSalary(jobposting.baseSalary);
  const gbp = structured ? null : extractGbpRange(description);
  return {
    ats: "teamtailor",
    external_id: String(item.id ?? ""),
    company_slug: company.slug,
    company_name: company.company_name,
    title: str(item.title),
    city: ukCityOf(locationRaw),
    country_code: "GB",
    location_raw: locationRaw,
    remote_type: null,
    employment_type: str(jobposting.employmentType) || null,
    salary_min: structured?.min ?? gbp?.min ?? null,
    salary_max: structured?.max ?? gbp?.max ?? null,
    salary_currency: structured ? structured.currency : gbp ? "GBP" : null,
    salary_raw: gbp ? `£${gbp.min}–£${gbp.max}` : null,
    description_text: description,
    apply_url: str(item.url),
    posted_at: str(item.date_published) || null,
  };
}

export const fetchTeamtailor: Fetcher = async (company) => {
  if (!company.careers_url) return { ok: false, error: "no careers_url" };
  const r = await fetchJson(`${company.careers_url}/jobs.json`);
  if (r.status === 404) return { ok: false, error: "jobs.json 404", gone: true };
  if (r.status !== 200) return { ok: false, error: `http ${r.status}` };
  const items = rec(r.body).items;
  if (!Array.isArray(items)) return { ok: false, error: "malformed body" };
  const out: JobRecord[] = [];
  for (const raw of items) {
    const j = normalizeTeamtailor(raw, company);
    if (j && j.external_id && j.title && j.apply_url) out.push(j);
  }
  return { ok: true, jobs: out };
};

import type { CompanyRow, Fetcher, JobRecord } from "../types";
import { fetchJson } from "../lib/http";
import { stripHtml, truncateText } from "../lib/text";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const PAGE_SIZE = 100;
const HARD_CAP = 500;

/** Base record from listing fields only — the known-id short-circuit uses this as-is
 *  (description_text: "" is the keep-stored-description sentinel for the upsert layer);
 *  unknown ids pass this into mergeSrDetail to fill apply_url/description/salary. */
export function normalizeSrListing(raw: unknown, company: CompanyRow): JobRecord | null {
  const j = rec(raw);
  const loc = rec(j.location);
  if (str(loc.country).toLowerCase() !== "gb") return null;
  const id = String(j.id ?? "");
  return {
    ats: "smartrecruiters",
    external_id: id,
    company_slug: company.slug,
    company_name: company.company_name,
    title: str(j.name),
    city: str(loc.city) || null,
    country_code: "GB",
    location_raw: str(loc.city),
    remote_type: bool(loc.remote) ? "remote" : bool(loc.hybrid) ? "hybrid" : "onsite",
    employment_type: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_raw: null,
    description_text: "",
    apply_url: id ? `https://jobs.smartrecruiters.com/${company.slug}/${id}` : "",
    posted_at: str(j.releasedDate) || null,
  };
}

/** Merges a postings/{id} detail payload onto a listing-derived record for jobs not already stored. */
export function mergeSrDetail(record: JobRecord, detailRaw: unknown): JobRecord {
  const d = rec(detailRaw);
  const sections = rec(rec(d.jobAd).sections);
  const description = truncateText(
    stripHtml(
      Object.values(sections)
        .map((s) => str(rec(s).text))
        .filter((t) => t)
        .join(" "),
    ),
    5000,
  );
  const comp = rec(d.compensation);
  return {
    ...record,
    apply_url: str(d.postingUrl) || record.apply_url,
    description_text: description,
    salary_min: num(comp.min),
    salary_max: num(comp.max),
    salary_currency: str(comp.currency) || null,
  };
}

export const fetchSmartRecruiters: Fetcher = async (company, ctx) => {
  const content: unknown[] = [];
  let totalFound = 0;
  let offset = 0;
  while (true) {
    const r = await fetchJson(
      `https://api.smartrecruiters.com/v1/companies/${company.slug}/postings?limit=${PAGE_SIZE}&offset=${offset}`,
    );
    if (r.status !== 200) return { ok: false, error: `http ${r.status}` };
    const body = rec(r.body);
    totalFound = num(body.totalFound) ?? 0;
    const page = arr(body.content);
    content.push(...page);
    offset += PAGE_SIZE;
    if (page.length === 0 || content.length >= totalFound || content.length >= HARD_CAP) break;
  }
  // totalFound === 0 (including unknown slugs, which SmartRecruiters answers with 200) is a
  // valid empty result at ingest time — never mark gone from this fetch.
  const listings = content.slice(0, HARD_CAP);

  const out: JobRecord[] = [];
  for (const raw of listings) {
    const base = normalizeSrListing(raw, company);
    if (!base) continue; // non-UK
    if (ctx.existingIds.has(base.external_id)) {
      out.push(base);
      continue;
    }
    const detailR = await fetchJson(
      `https://api.smartrecruiters.com/v1/companies/${company.slug}/postings/${base.external_id}`,
    );
    if (detailR.status !== 200) {
      // Drop this first-seen job for this run rather than pushing description_text: "" — that
      // empty string is the keep-stored-description sentinel, and a first-seen job has nothing
      // stored yet. Because it's dropped, it's never upserted, so it stays absent from
      // existingIds and the next scheduled run naturally retries the detail call.
      continue;
    }
    out.push(mergeSrDetail(base, detailR.body));
  }
  return { ok: true, jobs: out.filter((j) => j.external_id && j.title && j.apply_url) };
};

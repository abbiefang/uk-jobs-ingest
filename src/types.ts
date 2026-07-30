export interface JobRecord {
  ats: string;
  external_id: string;
  company_slug: string;
  company_name: string;
  title: string;
  city: string | null;
  country_code: "GB";
  location_raw: string;
  remote_type: "remote" | "hybrid" | "onsite" | null;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_raw: string | null;
  description_text: string;
  apply_url: string;
  posted_at: string | null; // ISO
}

export interface CompanyRow {
  slug: string;
  ats: string;
  company_name: string;
  careers_url: string | null;
  sponsor_matched: boolean;
  status: "active" | "dead" | "empty";
  consecutive_failures: number;
}

export interface FetchCtx {
  /** external_ids already stored for this (ats, company) — lets fetchers skip per-posting detail calls for known jobs (SmartRecruiters). */
  existingIds: Set<string>;
}

export type FetchOutcome =
  | { ok: true; jobs: JobRecord[] }
  | { ok: false; error: string; gone?: boolean }; // gone=true → 404-class, counts toward slug death

export type Fetcher = (company: CompanyRow, ctx: FetchCtx) => Promise<FetchOutcome>;

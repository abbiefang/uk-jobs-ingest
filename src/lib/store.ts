/** Ids of rows currently active in the DB whose external_id no longer appears in this run's fetch. */
export function planDeactivations(
  existing: { id: number; external_id: string }[],
  fetched: Set<string>,
): number[] {
  return existing.filter((row) => !fetched.has(row.external_id)).map((row) => row.id);
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** True when a paginated PostgREST response is trustworthy enough to treat as real data. Used
 *  to tell a genuine end-of-table page (a short array on a 2xx) apart from a transient error
 *  (5xx, malformed body) that would otherwise look identical to "no more rows" — callers should
 *  fail loud (throw) rather than silently truncate on a false negative here. */
export function isSuccessfulPage(status: number, body: unknown): body is unknown[] {
  return status >= 200 && status < 300 && Array.isArray(body);
}

/** Last write wins per external_id — guards against a fetcher returning the same posting more
 *  than once in one run (e.g. SmartRecruiters' offset-based listing pages can overlap), which
 *  would otherwise make PostgREST's ON CONFLICT batch upsert reject the whole chunk (error
 *  21000: "ON CONFLICT DO UPDATE command cannot affect row a second time"). */
export function dedupeByExternalId<T extends { external_id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) byId.set(row.external_id, row);
  return [...byId.values()];
}

const TOUCH_STRIPPED_KEYS = [
  "description_text",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_raw",
  "apply_url",
] as const;

/** Splits already-built upsert rows into "full" (send every field) vs "touch" rows, and strips
 *  the touch rows down to a pure still-alive ping. A row is "touch" when description_text ===
 *  "" — the SmartRecruiters known-job short-circuit sentinel — which means the listing call
 *  that produced it carries no salary and only a constructed (non-canonical) apply_url, not
 *  the real ones already stored from the original detail-call upsert. Sending those synthetic
 *  values would make merge-duplicates overwrite genuine stored salary/apply_url with nulls or
 *  a reconstructed guess on every later run, so the keys are deleted entirely and the merge
 *  leaves the stored values untouched. Returned as two arrays because a single PostgREST
 *  request body requires uniform columns across all its rows. */
export function splitUpsertRows(
  rows: Record<string, unknown>[],
): { full: Record<string, unknown>[]; touch: Record<string, unknown>[] } {
  const full: Record<string, unknown>[] = [];
  const touch: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (row.description_text === "") {
      const stripped = { ...row };
      for (const key of TOUCH_STRIPPED_KEYS) delete stripped[key];
      touch.push(stripped);
    } else {
      full.push(row);
    }
  }
  return { full, touch };
}

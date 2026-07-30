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

/** Splits already-built upsert rows into "full" (send every field, POST upsert) vs "touch"
 *  rows. A row is "touch" when description_text === "" — the SmartRecruiters known-job
 *  short-circuit sentinel — which means the listing call that produced it carries no salary
 *  and only a constructed (non-canonical) apply_url, not the real ones already stored from the
 *  original detail-call upsert. Those synthetic values must never reach an
 *  INSERT ... ON CONFLICT DO UPDATE: Postgres validates NOT NULL columns (apply_url,
 *  description_text) on the *proposed insert row* before it even evaluates the conflict, so a
 *  touch row would 400 the whole batch regardless of the row already existing. The caller
 *  (ingest.ts) instead refreshes touch rows with a plain PATCH by identity, so touch entries
 *  here carry only the identity keys that PATCH needs. */
export function splitUpsertRows(
  rows: Record<string, unknown>[],
): { full: Record<string, unknown>[]; touch: Record<string, unknown>[] } {
  const full: Record<string, unknown>[] = [];
  const touch: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (row.description_text === "") {
      touch.push({ ats: row.ats, company_slug: row.company_slug, external_id: row.external_id });
    } else {
      full.push(row);
    }
  }
  return { full, touch };
}

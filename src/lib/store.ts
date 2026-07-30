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

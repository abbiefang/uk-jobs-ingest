export function unescapeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

export function stripHtml(s: string): string {
  return unescapeEntities(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** `String.slice` truncates by UTF-16 code unit, which can cut an astral character's surrogate
 *  pair in half — the resulting lone high surrogate produces invalid UTF-8 once JSON-serialized
 *  and sent over HTTP, which broke a real production write (Postgres/PostgREST rejected the
 *  whole batch as "Empty or invalid json"). Drops a trailing unpaired high surrogate instead. */
export function truncateText(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastCode = cut.charCodeAt(cut.length - 1);
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** First "£40,000 - £55,000"-style range or single figure in free text. */
export function extractGbpRange(s: string): { min: number; max: number } | null {
  const range = s.match(/£\s?([\d,]{4,9})(?:\s?(?:-|–|to)\s?£?\s?([\d,]{4,9}))?/i);
  if (!range) return null;
  const min = Number(range[1].replace(/,/g, ""));
  const max = range[2] ? Number(range[2].replace(/,/g, "")) : min;
  if (!Number.isFinite(min) || min < 10_000 || min > 1_000_000) return null;
  return { min, max: Math.max(min, max) };
}

const UK_CITIES = [
  "london","manchester","birmingham","edinburgh","glasgow","leeds","bristol",
  "cambridge","oxford","cardiff","belfast","liverpool","newcastle","sheffield",
  "nottingham","southampton","reading","brighton","milton keynes","york",
  "londonderry","derry",
] as const;

// Substrings that mark a location as clearly NOT the UK (e.g. "New York" contains "york"). Only
// consulted when no explicit UK marker matched first — "northern ireland" is a UK marker above,
// so it's never reached here even though it contains "ireland". Plain `.includes()`, not
// word-boundary: covers the common free-text forms without the false-positive risk of a bare
// \bus\b/\bca\b (e.g. many US state abbreviations collide with ordinary words).
const NON_UK_MARKERS = [
  "new york", "united states", "usa", "us,", ", us",
  "canada", "australia", "ireland",
  "dublin", "toronto", "vancouver", "sydney", "melbourne", "auckland",
  "singapore", "hong kong", "india", "berlin", "paris", "amsterdam",
  "madrid", "barcelona", "dubai",
] as const;

/** Matches `term` as a whole word (surrounded by string edges or non-letters) — a plain
 *  `.includes()` would let "york" match inside "New York" or "london" match inside
 *  "Londonderry". */
function wordBoundaryRegex(term: string): RegExp {
  return new RegExp(`(^|[^a-z])${term}($|[^a-z])`);
}

export function isUkLocation(locationRaw: string, countryCode?: string | null): boolean {
  const cc = (countryCode ?? "").trim().toLowerCase();
  if (cc === "gb" || cc === "uk" || cc === "united kingdom") return true;
  if (cc && cc !== "") return false; // explicit non-UK country wins
  const l = locationRaw.toLowerCase();
  if (/(united kingdom|\buk\b|\(uk\)|england|scotland|wales|northern ireland)/.test(l)) return true;
  if (NON_UK_MARKERS.some((m) => l.includes(m))) return false;
  return UK_CITIES.some((c) => wordBoundaryRegex(c).test(l));
}

export function ukCityOf(locationRaw: string): string | null {
  const l = locationRaw.toLowerCase();
  let earliestCity: string | null = null;
  let earliestIndex = Infinity;
  for (const c of UK_CITIES) {
    const match = wordBoundaryRegex(c).exec(l);
    if (match && match.index < earliestIndex) {
      earliestIndex = match.index;
      earliestCity = c;
    }
  }
  return earliestCity ? earliestCity.replace(/\b\w/g, (m) => m.toUpperCase()) : null;
}

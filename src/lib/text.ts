export function unescapeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

export function stripHtml(s: string): string {
  return unescapeEntities(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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
] as const;

export function isUkLocation(locationRaw: string, countryCode?: string | null): boolean {
  const cc = (countryCode ?? "").trim().toLowerCase();
  if (cc === "gb" || cc === "uk" || cc === "united kingdom") return true;
  if (cc && cc !== "") return false; // explicit non-UK country wins
  const l = locationRaw.toLowerCase();
  if (/(united kingdom|\buk\b|\(uk\)|england|scotland|wales|northern ireland)/.test(l)) return true;
  return UK_CITIES.some((c) => l.includes(c));
}

export function ukCityOf(locationRaw: string): string | null {
  const l = locationRaw.toLowerCase();
  let earliestCity: string | null = null;
  let earliestIndex = Infinity;
  for (const c of UK_CITIES) {
    const idx = l.indexOf(c);
    if (idx >= 0 && idx < earliestIndex) {
      earliestIndex = idx;
      earliestCity = c;
    }
  }
  return earliestCity ? earliestCity.replace(/\b\w/g, (m) => m.toUpperCase()) : null;
}

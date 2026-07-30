// Ported verbatim from the main app repo's
// supabase/functions/search-real-jobs/sponsor.ts (normalizeCompany + its SUFFIXES
// table only). No shared package between the two repos, so this can drift — if the
// main repo's normalization changes, re-copy it here.

// Corporate suffixes / fillers stripped during normalization.
const SUFFIXES = [
  " limited",
  " ltd",
  " ltd.",
  " plc",
  " plc.",
  " llp",
  " llp.",
  " l.l.p.",
  " l.l.p",
  " uk",
  " (uk)",
  " group",
  " international",
  " holdings",
  " (europe)",
  " europe",
  " (emea)",
  " emea",
  " investments",
  " investment",
  " management",
  " asset management",
  " & co",
  " and co",
  " & company",
  " inc",
  " inc.",
  " corporation",
];

/** Normalize a company name for register matching — port of _normalize(). */
export function normalizeCompany(name: string): string {
  if (!name) return "";
  let n = name.toLowerCase().trim();
  n = n.replace(/[.,\-_/\\()]+/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of SUFFIXES) {
      if (n.endsWith(s)) {
        n = n.slice(0, n.length - s.length).trim();
        changed = true;
      }
    }
  }
  return n;
}

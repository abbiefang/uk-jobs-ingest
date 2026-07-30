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

// Trailing words stripped when building ATS slug guesses. Deliberately a smaller/plainer set
// than normalizeCompany's SUFFIXES above (single bare words, not " (uk)"-style parenthetical
// forms) — this runs on whitespace-split tokens, not the whole string.
const SLUG_SUFFIX_WORDS = new Set(["ltd", "limited", "plc", "llp", "uk", "group", "holdings"]);

function stripTrailingSuffixWords(words: string[]): string[] {
  const out = [...words];
  // Never pop the last remaining word, even if it matches — an all-suffix name (e.g. "Ltd
  // Group") must still produce a non-empty base rather than reducing to [].
  while (out.length > 1 && SLUG_SUFFIX_WORDS.has(out[out.length - 1].replace(/[^a-z0-9]/g, ""))) {
    out.pop();
  }
  return out;
}

function toSlug(s: string): string {
  return s
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Guesses at the ATS board slug a company might be registered under, for probing
 * (greenhouse/lever/etc. host paths). Not authoritative — callers try each variant in turn.
 * ⇐ ≤6 variants, deduped, never an empty string.
 */
export function slugVariants(name: string): string[] {
  if (!name) return [];
  const words = stripTrailingSuffixWords(name.toLowerCase().trim().split(/\s+/).filter(Boolean));
  if (words.length === 0) return [];

  const bases = new Set<string>();
  const base = words.join(" ");
  bases.add(base);
  if (base.includes("&")) bases.add(base.replace(/&/g, "and"));
  // Many companies' real ATS slug is just their most distinctive (first) word, especially when
  // the legal name tacks on a descriptor normalizeCompany's suffix list doesn't cover (e.g.
  // "Monzo Bank Ltd" → ats slug "monzo", not "monzo-bank").
  if (words.length > 1) bases.add(words[0]);

  const variants: string[] = [];
  for (const b of bases) {
    variants.push(toSlug(b.replace(/\s+/g, "")));
    variants.push(toSlug(b.replace(/\s+/g, "-")));
  }

  return [...new Set(variants)].filter((v) => v.length > 0).slice(0, 6);
}

/**
 * Minimal RFC4180-ish single-line CSV field splitter: handles quoted fields, commas inside
 * quotes, and doubled-quote escaping ("" → "). Does NOT handle quoted fields spanning multiple
 * lines — callers split CSV text into lines first, which is fine for the register/ats-companies
 * CSVs this reads (no embedded newlines in their quoted fields).
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

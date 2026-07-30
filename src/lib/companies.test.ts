import { describe, expect, it } from "vitest";
import { normalizeCompany, parseCsvLine, slugVariants } from "./companies";

describe("slugVariants", () => {
  it("covers full, hyphenated, and first-word forms for a legal-suffix name", () => {
    const variants = slugVariants("Monzo Bank Ltd");
    expect(variants).toEqual(expect.arrayContaining(["monzobank", "monzo-bank", "monzo"]));
  });

  it("lowercases and dedupes, staying at or under the 6-variant cap", () => {
    const variants = slugVariants("Acme Group Holdings Limited");
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.length).toBeLessThanOrEqual(6);
    expect(new Set(variants).size).toBe(variants.length);
    for (const v of variants) expect(v).toMatch(/^[a-z0-9-]+$/);
  });

  it("produces an 'and' variant alongside the '&' name", () => {
    const variants = slugVariants("Marks & Spencer plc");
    expect(variants).toEqual(expect.arrayContaining(["marksandspencer", "marks-and-spencer"]));
  });

  it("never returns empty strings and returns [] for an empty name", () => {
    expect(slugVariants("")).toEqual([]);
    for (const v of slugVariants("Ltd")) expect(v.length).toBeGreaterThan(0);
  });
});

// normalizeCompany is a verbatim port of the main repo's sponsor.ts — these cases are drawn
// from supabase/functions/search-real-jobs/sponsor.deno.test.ts (read-only reference) to catch
// drift between the two copies rather than re-deriving new expectations from scratch.
describe("normalizeCompany parity with main repo's sponsor.ts", () => {
  it("absorbs common legal suffixes (direct case from sponsor.deno.test.ts)", () => {
    expect(normalizeCompany("  Royal-London Group Ltd.  ")).toBe("royal london");
  });

  it("normalizes 'Care Ltd' the way the exact-match fixture there relies on", () => {
    // sponsor.deno.test.ts's createSponsorMatcher test asserts matches("Care Ltd") === "exact"
    // against a sponsor list containing "care" — that only holds if normalizeCompany("Care Ltd") === "care".
    expect(normalizeCompany("Care Ltd")).toBe("care");
  });

  it("leaves a single-token name with no suffix untouched", () => {
    // sponsor.deno.test.ts's "leading matching uses whole tokens" and "recruiters" tests rely on
    // normalizeCompany("Meta") / normalizeCompany("Hays") being the bare lowercased token.
    expect(normalizeCompany("Meta")).toBe("meta");
    expect(normalizeCompany("Hays")).toBe("hays");
  });

  it("keeps connector words like 'and' — only punctuation and legal suffixes are stripped", () => {
    // Underpins sponsor.deno.test.ts's "connector variants do not block an otherwise specific
    // match" case (matches("Legal and General") against a "legal & general resources" fixture).
    expect(normalizeCompany("Legal and General")).toBe("legal and general");
  });
});

describe("parseCsvLine", () => {
  it("splits plain comma-separated fields", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a comma inside a quoted field intact", () => {
    expect(parseCsvLine('Acme Inc,"London, UK",Skilled Worker')).toEqual([
      "Acme Inc",
      "London, UK",
      "Skilled Worker",
    ]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(parseCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  });

  it("returns a single empty field for an empty line", () => {
    expect(parseCsvLine("")).toEqual([""]);
  });
});

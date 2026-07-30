import { describe, expect, it } from "vitest";
import { normalizeWorkable } from "./workable";

const company = { slug: "starling-bank", ats: "workable", company_name: "Starling Bank", careers_url: null, sponsor_matched: true, status: "active" as const, consecutive_failures: 0 };

const raw = {
  shortcode: "AB12CD",
  title: "Compliance Manager",
  city: "London",
  country: "United Kingdom",
  url: "https://apply.workable.com/j/AB12CD",
  application_url: "https://apply.workable.com/j/AB12CD/apply",
  published_on: "2026-07-28",
  employment_type: "Full-time",
  telecommuting: true,
  description: "<p>Regulated products role. £60,000 - £75,000.</p>",
};

describe("normalizeWorkable", () => {
  it("maps a UK job with telecommuting → hybrid remote_type and salary from description", () => {
    const j = normalizeWorkable(raw, company);
    expect(j).toMatchObject({
      ats: "workable",
      external_id: "AB12CD",
      company_name: "Starling Bank",
      title: "Compliance Manager",
      city: "London",
      country_code: "GB",
      posted_at: "2026-07-28T00:00:00.000Z",
      remote_type: "hybrid",
      apply_url: "https://apply.workable.com/j/AB12CD/apply",
      salary_min: 60000,
      salary_max: 75000,
      salary_currency: "GBP",
    });
    expect(j!.description_text).toContain("Regulated products role");
  });

  it("drops non-UK country", () => {
    expect(
      normalizeWorkable({ ...raw, country: "United States", city: "New York" }, company)
    ).toBeNull();
  });

  it("sets remote_type to null when telecommuting is false", () => {
    const j = normalizeWorkable({ ...raw, telecommuting: false }, company);
    expect(j?.remote_type).toBeNull();
  });

  it("prefers application_url over url for apply_url", () => {
    const j = normalizeWorkable({ ...raw, application_url: "https://apply.workable.com/j/AB12CD/apply" }, company);
    expect(j?.apply_url).toBe("https://apply.workable.com/j/AB12CD/apply");
  });

  it("falls back to url if application_url is missing", () => {
    const j = normalizeWorkable({ ...raw, application_url: undefined }, company);
    expect(j?.apply_url).toBe("https://apply.workable.com/j/AB12CD");
  });
});

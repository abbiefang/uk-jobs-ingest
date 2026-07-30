import { describe, expect, it } from "vitest";
import { normalizeGreenhouse } from "./greenhouse";

const company = { slug: "monzo", ats: "greenhouse", company_name: "Monzo", careers_url: null, sponsor_matched: true, status: "active" as const, consecutive_failures: 0 };

const raw = {
  id: 7123456, title: "Staff Engineer", absolute_url: "https://job-boards.greenhouse.io/monzo/jobs/7123456",
  updated_at: "2026-07-29T10:00:00-04:00", first_published: "2026-07-28T09:00:00-04:00",
  location: { name: "Cardiff, London or Remote (UK)" },
  content: "&lt;div&gt;Base salary £95,000 - £120,000.&lt;/div&gt;",
};

describe("normalizeGreenhouse", () => {
  it("maps a UK job with salary lifted from content", () => {
    const j = normalizeGreenhouse(raw, company);
    expect(j).toMatchObject({
      ats: "greenhouse", external_id: "7123456", company_name: "Monzo",
      apply_url: "https://job-boards.greenhouse.io/monzo/jobs/7123456",
      posted_at: "2026-07-28T09:00:00-04:00", city: "Cardiff",
      salary_min: 95000, salary_max: 120000, salary_currency: "GBP",
    });
    expect(j!.description_text).toContain("Base salary");
  });
  it("drops non-UK locations", () => {
    expect(normalizeGreenhouse({ ...raw, location: { name: "Barcelona" } }, company)).toBeNull();
  });
});

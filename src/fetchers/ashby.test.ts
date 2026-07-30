import { describe, expect, it } from "vitest";
import { normalizeAshby } from "./ashby";

const company = { slug: "synthesia", ats: "ashby", company_name: "Synthesia", careers_url: null, sponsor_matched: true, status: "active" as const, consecutive_failures: 0 };

const raw = {
  id: "uuid-1",
  title: "Robotics Engineer",
  location: "London",
  secondaryLocations: [],
  publishedAt: "2026-07-29T08:00:00Z",
  isRemote: false,
  employmentType: "FullTime",
  jobUrl: "https://jobs.ashbyhq.com/synthesia/uuid-1",
  applyUrl: "https://jobs.ashbyhq.com/synthesia/uuid-1/application",
  descriptionHtml: "<p>Autonomy stack role. £90,000 - £110,000.</p>",
  compensation: { compensationTierSummary: "" },
};

describe("normalizeAshby", () => {
  it("maps a UK job with salary lifted from description when compensation summary empty", () => {
    const j = normalizeAshby(raw, company);
    expect(j).toMatchObject({
      ats: "ashby",
      external_id: "uuid-1",
      company_name: "Synthesia",
      title: "Robotics Engineer",
      city: "London",
      country_code: "GB",
      posted_at: "2026-07-29T08:00:00Z",
      apply_url: "https://jobs.ashbyhq.com/synthesia/uuid-1",
      remote_type: null,
      salary_min: 90000,
      salary_max: 110000,
      salary_currency: "GBP",
    });
    expect(j!.description_text).toContain("Autonomy stack role");
  });

  it("drops non-UK locations", () => {
    expect(
      normalizeAshby({ ...raw, location: "Barcelona", secondaryLocations: [] }, company)
    ).toBeNull();
  });

  it("sets remote_type to 'remote' when isRemote is true", () => {
    const j = normalizeAshby({ ...raw, isRemote: true }, company);
    expect(j?.remote_type).toBe("remote");
  });

  it("prefers jobUrl if applyUrl is missing", () => {
    const j = normalizeAshby({ ...raw, applyUrl: undefined }, company);
    expect(j?.apply_url).toBe("https://jobs.ashbyhq.com/synthesia/uuid-1");
  });

  it("respects secondaryLocations for UK check", () => {
    const j = normalizeAshby(
      {
        ...raw,
        location: "Manchester",
        secondaryLocations: [{ location: "Liverpool" }, { location: "London" }],
      },
      company
    );
    expect(j).not.toBeNull();
    expect(j?.city).toMatch(/^(Manchester|Liverpool|London)$/);
  });
});

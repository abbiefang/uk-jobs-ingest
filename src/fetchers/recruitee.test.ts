import { describe, expect, it } from "vitest";
import { normalizeRecruitee } from "./recruitee";

const company = { slug: "framestore", ats: "recruitee", company_name: "Framestore", careers_url: null, sponsor_matched: true, status: "active" as const, consecutive_failures: 0 };

const raw = {
  id: 2654975,
  title: "Senior Cloud Developer",
  city: "London",
  country_code: "GB",
  location: "London, Greater London, United Kingdom",
  careers_url: "https://framestore.recruitee.com/o/senior-cloud-dev",
  careers_apply_url: "https://framestore.recruitee.com/o/senior-cloud-dev/c/new",
  published_at: "2026-06-25 14:20:16 UTC",
  created_at: "2026-06-25 14:02:41 UTC",
  description: "<p>Build the cloud platform.</p>",
  requirements: "<p>5+ years experience.</p>",
  salary: { min: "45000", max: "60000", currency: "GBP" },
  employment_type_code: "fulltime_permanent",
  remote: false,
  hybrid: true,
  on_site: true,
};

describe("normalizeRecruitee", () => {
  it("maps a UK offer with careers_apply_url and string salary coerced to numbers", () => {
    const j = normalizeRecruitee(raw, company);
    expect(j).toMatchObject({
      ats: "recruitee",
      external_id: "2654975",
      company_name: "Framestore",
      title: "Senior Cloud Developer",
      city: "London",
      country_code: "GB",
      remote_type: "hybrid",
      apply_url: "https://framestore.recruitee.com/o/senior-cloud-dev/c/new",
      posted_at: "2026-06-25 14:20:16 UTC",
      salary_min: 45000,
      salary_max: 60000,
      salary_currency: "GBP",
    });
    expect(j!.description_text).toContain("Build the cloud platform");
    expect(j!.description_text).toContain("5+ years experience");
  });

  it("drops non-UK country_code", () => {
    expect(
      normalizeRecruitee({ ...raw, country_code: "US", city: "New York", location: "New York, USA" }, company),
    ).toBeNull();
  });

  it("falls back to careers_url when careers_apply_url is missing", () => {
    const j = normalizeRecruitee({ ...raw, careers_apply_url: undefined }, company);
    expect(j?.apply_url).toBe("https://framestore.recruitee.com/o/senior-cloud-dev");
  });

  it("falls back to isUkLocation text check when country_code is absent", () => {
    const j = normalizeRecruitee({ ...raw, country_code: undefined, location: "London, UK" }, company);
    expect(j).not.toBeNull();
  });
});

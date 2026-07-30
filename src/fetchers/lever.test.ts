import { describe, expect, it } from "vitest";
import { normalizeLever } from "./lever";

const company = { slug: "zopa", ats: "lever", company_name: "Zopa Bank", careers_url: null, sponsor_matched: true, status: "active" as const, consecutive_failures: 0 };

const raw = {
  id: "a1b2c3", text: "Data Scientist", country: "GB", workplaceType: "hybrid",
  createdAt: 1785300000000,
  categories: { location: "London", commitment: "Full-time" },
  hostedUrl: "https://jobs.lever.co/zopa/a1b2c3", applyUrl: "https://jobs.lever.co/zopa/a1b2c3/apply",
  descriptionPlain: "Join the data team.",
  salaryRange: { min: 70000, max: 90000, currency: "GBP", interval: "per-year-salary" },
};

describe("normalizeLever", () => {
  it("maps a UK posting with structured salary and epoch date", () => {
    const j = normalizeLever(raw, company);
    expect(j).toMatchObject({
      ats: "lever", external_id: "a1b2c3", title: "Data Scientist",
      city: "London", remote_type: "hybrid", employment_type: "Full-time",
      salary_min: 70000, salary_max: 90000, salary_currency: "GBP",
      apply_url: "https://jobs.lever.co/zopa/a1b2c3",
    });
    expect(j!.posted_at).toBe(new Date(1785300000000).toISOString());
  });
  it("drops non-UK country", () => {
    expect(normalizeLever({ ...raw, country: "US", categories: { location: "NYC" } }, company)).toBeNull();
  });
});

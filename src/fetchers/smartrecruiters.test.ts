import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSmartRecruiters, mergeSrDetail, normalizeSrListing } from "./smartrecruiters";
import type { FetchCtx } from "../types";

const company = { slug: "Wise", ats: "smartrecruiters", company_name: "Wise", careers_url: null, sponsor_matched: true, status: "active" as const, consecutive_failures: 0 };

const listingRaw = {
  id: "744000012",
  name: "Finance Analyst",
  releasedDate: "2026-07-29T09:00:00Z",
  location: { city: "London", country: "gb", remote: false, hybrid: true },
};

const detailRaw = {
  postingUrl: "https://jobs.smartrecruiters.com/Wise/744000012-finance-analyst",
  applyUrl: "https://jobs.smartrecruiters.com/Wise/744000012-finance-analyst/apply",
  jobAd: {
    sections: {
      jobDescription: { text: "<p>Own the numbers.</p>" },
      qualifications: { text: "" },
    },
  },
  compensation: { min: 60000, max: 75000, currency: "GBP" },
};

describe("normalizeSrListing", () => {
  it("maps a UK listing with hybrid remote_type, constructed apply_url, and empty description sentinel", () => {
    const j = normalizeSrListing(listingRaw, company);
    expect(j).toMatchObject({
      ats: "smartrecruiters",
      external_id: "744000012",
      title: "Finance Analyst",
      city: "London",
      country_code: "GB",
      remote_type: "hybrid",
      posted_at: "2026-07-29T09:00:00Z",
      apply_url: "https://jobs.smartrecruiters.com/Wise/744000012",
      description_text: "",
    });
  });

  it("drops non-UK country", () => {
    expect(
      normalizeSrListing({ ...listingRaw, location: { ...listingRaw.location, country: "us" } }, company),
    ).toBeNull();
  });
});

describe("mergeSrDetail", () => {
  it("merges detail fields onto the listing-derived record", () => {
    const base = normalizeSrListing(listingRaw, company)!;
    const merged = mergeSrDetail(base, detailRaw);
    expect(merged.apply_url).toBe("https://jobs.smartrecruiters.com/Wise/744000012-finance-analyst");
    expect(merged.description_text).toContain("Own the numbers");
    expect(merged.salary_min).toBe(60000);
    expect(merged.salary_max).toBe(75000);
    expect(merged.salary_currency).toBe("GBP");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return { status, text: async () => JSON.stringify(body) } as Response;
}

describe("fetchSmartRecruiters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("totalFound: 0 is valid-empty, never gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ totalFound: 0, content: [] })));
    const ctx: FetchCtx = { existingIds: new Set() };
    const result = await fetchSmartRecruiters(company, ctx);
    expect(result).toEqual({ ok: true, jobs: [] });
  });

  it("known ids short-circuit the detail call: listing fields only, empty description sentinel, constructed apply_url", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("/postings?")) return jsonResponse({ totalFound: 1, content: [listingRaw] });
        throw new Error(`unexpected detail call: ${url}`);
      }),
    );
    const ctx: FetchCtx = { existingIds: new Set(["744000012"]) };
    const result = await fetchSmartRecruiters(company, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].description_text).toBe("");
      expect(result.jobs[0].apply_url).toBe("https://jobs.smartrecruiters.com/Wise/744000012");
    }
    expect(calls.some((u) => u.includes("/postings/744000012"))).toBe(false);
  });

  it("unknown ids fetch detail and merge apply_url, description, salary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/postings?")) return jsonResponse({ totalFound: 1, content: [listingRaw] });
        if (u.includes("/postings/744000012")) return jsonResponse(detailRaw);
        throw new Error(`unexpected call: ${url}`);
      }),
    );
    const ctx: FetchCtx = { existingIds: new Set() };
    const result = await fetchSmartRecruiters(company, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].apply_url).toBe("https://jobs.smartrecruiters.com/Wise/744000012-finance-analyst");
      expect(result.jobs[0].salary_min).toBe(60000);
      expect(result.jobs[0].description_text).toContain("Own the numbers");
    }
  });
});

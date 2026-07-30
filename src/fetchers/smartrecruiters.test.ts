import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSmartRecruiters, mergeSrDetail, normalizeSrListing } from "./smartrecruiters";
import type { FetchCtx } from "../types";
import { fetchJson } from "../lib/http";

vi.mock("../lib/http", () => ({ fetchJson: vi.fn() }));

const mockedFetchJson = vi.mocked(fetchJson);

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

function jsonResult(body: unknown, status = 200): { status: number; body: unknown } {
  return { status, body };
}

function makeListing(id: number) {
  return {
    id: String(id),
    name: `Job ${id}`,
    releasedDate: "2026-07-01T00:00:00Z",
    location: { city: "London", country: "gb", remote: false, hybrid: false },
  };
}

describe("fetchSmartRecruiters", () => {
  afterEach(() => {
    mockedFetchJson.mockReset();
  });

  it("totalFound: 0 is valid-empty, never gone", async () => {
    mockedFetchJson.mockResolvedValue(jsonResult({ totalFound: 0, content: [] }));
    const ctx: FetchCtx = { existingIds: new Set() };
    const result = await fetchSmartRecruiters(company, ctx);
    expect(result).toEqual({ ok: true, jobs: [] });
  });

  it("known ids short-circuit the detail call: listing fields only, empty description sentinel, constructed apply_url", async () => {
    const calls: string[] = [];
    mockedFetchJson.mockImplementation(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/postings?")) return jsonResult({ totalFound: 1, content: [listingRaw] });
      throw new Error(`unexpected detail call: ${u}`);
    });
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
    mockedFetchJson.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/postings?")) return jsonResult({ totalFound: 1, content: [listingRaw] });
      if (u.includes("/postings/744000012")) return jsonResult(detailRaw);
      throw new Error(`unexpected call: ${u}`);
    });
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

  it("drops an unknown-id job when its detail fetch fails, so it never enters the store and the next run retries it", async () => {
    mockedFetchJson.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/postings?")) return jsonResult({ totalFound: 1, content: [listingRaw] });
      if (u.includes("/postings/744000012")) return { status: 500, body: null };
      throw new Error(`unexpected call: ${u}`);
    });
    const ctx: FetchCtx = { existingIds: new Set() };
    const result = await fetchSmartRecruiters(company, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.jobs).toHaveLength(0);
  });

  it("pages through multiple listing pages honoring totalFound, and merges detail for postings on every page", async () => {
    const page0 = Array.from({ length: 100 }, (_, i) => makeListing(i));
    const page1 = Array.from({ length: 50 }, (_, i) => makeListing(100 + i));
    const requestedUrls: string[] = [];
    mockedFetchJson.mockImplementation(async (url) => {
      const u = String(url);
      requestedUrls.push(u);
      if (u.includes("/postings?limit=100&offset=0")) return jsonResult({ totalFound: 150, content: page0 });
      if (u.includes("/postings?limit=100&offset=100")) return jsonResult({ totalFound: 150, content: page1 });
      if (u.includes("/postings/")) {
        const id = u.split("/postings/")[1];
        return jsonResult({
          postingUrl: `https://jobs.smartrecruiters.com/Wise/${id}`,
          jobAd: { sections: {} },
          compensation: {},
        });
      }
      throw new Error(`unexpected call: ${u}`);
    });
    const ctx: FetchCtx = { existingIds: new Set() };
    const result = await fetchSmartRecruiters(company, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobs).toHaveLength(150);
      expect(result.jobs.some((j) => j.external_id === "0")).toBe(true); // from page 0
      expect(result.jobs.some((j) => j.external_id === "149")).toBe(true); // from page 1
    }
    expect(requestedUrls.some((u) => u.includes("offset=0"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("offset=100"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("offset=200"))).toBe(false); // paging stopped once totalFound was reached
  });

  it("stops paging at the 500 hard cap even when totalFound is larger", async () => {
    const requestedListingUrls: string[] = [];
    mockedFetchJson.mockImplementation(async (url) => {
      const u = String(url);
      const m = u.match(/offset=(\d+)/);
      if (!m) throw new Error(`unexpected call: ${u}`);
      requestedListingUrls.push(u);
      const offset = Number(m[1]);
      return jsonResult({ totalFound: 600, content: Array.from({ length: 100 }, (_, i) => makeListing(offset + i)) });
    });
    // Mark every id 0..599 as already known so the hard-cap arithmetic — not the detail-merge
    // path (covered above) — is what's under test here.
    const ctx: FetchCtx = { existingIds: new Set(Array.from({ length: 600 }, (_, i) => String(i))) };
    const result = await fetchSmartRecruiters(company, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.jobs).toHaveLength(500);
    expect(requestedListingUrls.some((u) => u.includes("offset=500"))).toBe(false); // never requests beyond the cap
  });
});

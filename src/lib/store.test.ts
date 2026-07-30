import { describe, expect, it } from "vitest";
import { chunk, dedupeByExternalId, isSuccessfulPage, planDeactivations, splitUpsertRows } from "./store";

describe("planDeactivations", () => {
  it("returns ids of rows whose external_id is absent from the fetched set", () => {
    const existing = [
      { id: 1, external_id: "a" },
      { id: 2, external_id: "b" },
      { id: 3, external_id: "c" },
    ];
    const fetched = new Set(["a", "c"]);
    expect(planDeactivations(existing, fetched)).toEqual([2]);
  });

  it("returns an empty array when every existing row is still fetched", () => {
    const existing = [{ id: 1, external_id: "a" }, { id: 2, external_id: "b" }];
    expect(planDeactivations(existing, new Set(["a", "b"]))).toEqual([]);
  });

  it("returns an empty array for an empty existing list", () => {
    expect(planDeactivations([], new Set(["a"]))).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits 1,001 items into 3 chunks of at most 500", () => {
    const arr = Array.from({ length: 1001 }, (_, i) => i);
    const chunks = chunk(arr, 500);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    expect(chunks.flat()).toEqual(arr);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunk([], 500)).toEqual([]);
  });
});

describe("dedupeByExternalId", () => {
  it("keeps the last row seen for each external_id", () => {
    const rows = [
      { external_id: "1", title: "old" },
      { external_id: "2", title: "keep" },
      { external_id: "1", title: "new" },
    ];
    expect(dedupeByExternalId(rows)).toEqual([
      { external_id: "1", title: "new" },
      { external_id: "2", title: "keep" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeByExternalId([])).toEqual([]);
  });
});

describe("splitUpsertRows", () => {
  const base = {
    ats: "smartrecruiters",
    company_slug: "acme",
    company_name: "Acme",
    title: "Engineer",
    city: "London",
    country_code: "GB",
    location_raw: "London",
    remote_type: null,
    employment_type: null,
    salary_currency: null,
    salary_raw: null,
    posted_at: null,
    sponsor_norm: "acme",
    last_seen_at: "2026-07-30T00:00:00.000Z",
    is_active: true,
  };
  it("splits full vs touch rows by description_text, reducing touch rows to identity keys only", () => {
    const fullRow = {
      ...base, external_id: "1", description_text: "A real description",
      salary_min: 50000, salary_max: 60000, apply_url: "https://jobs.example.com/postings/1",
    };
    const touchRow = {
      ...base, external_id: "2", description_text: "",
      salary_min: null, salary_max: null, apply_url: "https://jobs.smartrecruiters.com/acme/2",
    };

    const { full, touch } = splitUpsertRows([fullRow, touchRow]);

    expect(full).toEqual([fullRow]);
    expect(touch).toEqual([{ ats: "smartrecruiters", company_slug: "acme", external_id: "2" }]);
  });

  it("keeps each output batch internally uniform in its key set", () => {
    const fullA = { ...base, external_id: "1", description_text: "x", salary_min: 1, salary_max: 2, apply_url: "u1" };
    const fullB = { ...base, external_id: "2", description_text: "y", salary_min: 3, salary_max: 4, apply_url: "u2" };
    const touchA = { ...base, external_id: "3", description_text: "", salary_min: 5, salary_max: 6, apply_url: "u3" };
    const touchB = { ...base, external_id: "4", description_text: "", salary_min: 7, salary_max: 8, apply_url: "u4" };

    const { full, touch } = splitUpsertRows([fullA, touchA, fullB, touchB]);

    const keysOf = (r: Record<string, unknown>) => Object.keys(r).sort();
    expect(full).toHaveLength(2);
    expect(touch).toHaveLength(2);
    expect(keysOf(full[0])).toEqual(keysOf(full[1]));
    expect(keysOf(touch[0])).toEqual(keysOf(touch[1]));
    expect(keysOf(touch[0])).toEqual(["ats", "company_slug", "external_id"]);
  });

  it("returns empty arrays for empty input", () => {
    expect(splitUpsertRows([])).toEqual({ full: [], touch: [] });
  });
});

describe("isSuccessfulPage", () => {
  it("accepts a 200 with an array body", () => {
    expect(isSuccessfulPage(200, [{ id: 1 }])).toBe(true);
  });

  it("accepts a 206 partial-content array body", () => {
    expect(isSuccessfulPage(206, [])).toBe(true);
  });

  it("rejects a non-2xx status even with an array body", () => {
    expect(isSuccessfulPage(500, [])).toBe(false);
  });

  it("rejects a 2xx status whose body is not an array", () => {
    expect(isSuccessfulPage(200, { message: "not an array" })).toBe(false);
    expect(isSuccessfulPage(200, null)).toBe(false);
  });
});

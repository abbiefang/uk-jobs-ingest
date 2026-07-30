import { describe, expect, it } from "vitest";
import { chunk, planDeactivations } from "./store";

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

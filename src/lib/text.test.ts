import { describe, expect, it } from "vitest";
import { extractGbpRange, isUkLocation, stripHtml, ukCityOf } from "./text";

describe("stripHtml", () => {
  it("unescapes Greenhouse double-escaped HTML then strips tags", () => {
    expect(stripHtml("&lt;div&gt;Senior &amp; Staff&lt;/div&gt;")).toBe("Senior & Staff");
  });
});

describe("extractGbpRange", () => {
  it("parses a range", () => {
    expect(extractGbpRange("Salary £65,000 - £80,000 plus equity")).toEqual({ min: 65000, max: 80000 });
  });
  it("parses a single figure", () => {
    expect(extractGbpRange("up to £95,000")).toEqual({ min: 95000, max: 95000 });
  });
  it("rejects non-salary pounds", () => {
    expect(extractGbpRange("£500 travel budget")).toBeNull();
  });
});

describe("isUkLocation", () => {
  it("accepts explicit GB country code regardless of text", () => {
    expect(isUkLocation("Anywhere", "GB")).toBe(true);
  });
  it("rejects explicit non-UK country code", () => {
    expect(isUkLocation("London Street office", "US")).toBe(false);
  });
  it("accepts Greenhouse free-text UK forms", () => {
    expect(isUkLocation("Cardiff, London or Remote (UK)")).toBe(true);
  });
  it("rejects other cities with no UK marker", () => {
    expect(isUkLocation("Barcelona, Spain")).toBe(false);
  });
});

describe("ukCityOf", () => {
  it("extracts the first known city", () => {
    expect(ukCityOf("Hybrid — Manchester with monthly travel")).toBe("Manchester");
  });
  it("returns null when unknown", () => {
    expect(ukCityOf("Remote (UK)")).toBeNull();
  });
});

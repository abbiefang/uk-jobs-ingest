import { describe, expect, it } from "vitest";
import { selectProbeBatch } from "./discover";

const REGISTER = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

// Deliberate reproduction of the OLD (buggy, now-replaced) numeric-offset cursor this task's
// fix removes — kept only here, inline, to demonstrate in a test exactly the drift the
// reviewer reported. It is not exported anywhere in discover.ts anymore; the refactor to a
// content-anchored cursor (selectProbeBatch's new (registerNames, covered, after, size)
// signature below) makes this failure mode structurally unrepresentable in the real code, so
// this function exists solely as a regression demo, not something under test itself.
function oldNumericOffsetBatch(
  candidates: string[],
  offset: number,
  size: number,
): { batch: string[]; nextOffset: number } {
  if (candidates.length === 0) return { batch: [], nextOffset: 0 };
  const start = offset % candidates.length;
  const n = Math.min(size, candidates.length);
  const batch = Array.from({ length: n }, (_, i) => candidates[(start + i) % candidates.length]);
  return { batch, nextOffset: (start + n) % candidates.length };
}

describe("regression demo: the old numeric-offset cursor this task replaces", () => {
  it("silently jumps over names that should be next in line once hits shrink the candidate list", () => {
    // Run 1: offset 0, budget 4 over the full 10-name register.
    const run1 = oldNumericOffsetBatch(REGISTER, 0, 4);
    expect(run1.batch).toEqual(["a", "b", "c", "d"]);
    expect(run1.nextOffset).toBe(4);

    // b and d get probe hits — they're now covered, so the candidate list shrinks to 8.
    const remaining = REGISTER.filter((n) => n !== "b" && n !== "d");
    expect(remaining).toEqual(["a", "c", "e", "f", "g", "h", "i", "j"]);

    // Run 2 reinterprets the SAME numeric offset (4) against the now-8-long list.
    const run2 = oldNumericOffsetBatch(remaining, run1.nextOffset, 4);
    expect(run2.batch).toEqual(["g", "h", "i", "j"]); // the reviewer's reported reproduction

    // a, c, e, f were the names conceptually "next in line" right after run 1's "d" — the
    // shrunk-array-vs-stale-offset math silently jumps over all four in this run.
    const jumpedOver = remaining.filter((n) => !run2.batch.includes(n));
    expect(jumpedOver).toEqual(["a", "c", "e", "f"]);
  });
});

describe("selectProbeBatch (content-anchored cursor)", () => {
  it("continues right after the previous cursor instead of jumping, for the same scenario that broke the old cursor", () => {
    const run1 = selectProbeBatch(REGISTER, new Set(), "", 4);
    expect(run1.batch).toEqual(["a", "b", "c", "d"]);
    expect(run1.nextAfter).toBe("d");

    // Same hits as the regression demo: b and d covered going into run 2.
    const covered = new Set(["b", "d"]);
    const run2 = selectProbeBatch(REGISTER, covered, run1.nextAfter, 4);
    // e, f — the names right after "d" — are included this time; nothing after the cursor is
    // jumped over. (a, c legitimately wait: they sort before the cursor, so they're due on the
    // next wrap, not skipped.)
    expect(run2.batch).toEqual(["e", "f", "g", "h"]);
    expect(run2.nextAfter).toBe("h");
  });

  it("covers every uncovered name across consecutive runs with no hits in between (wraparound)", () => {
    const covered = new Set(["b", "d"]);
    const run1 = selectProbeBatch(REGISTER, covered, "", 4);
    const run2 = selectProbeBatch(REGISTER, covered, run1.nextAfter, 4);
    const run3 = selectProbeBatch(REGISTER, covered, run2.nextAfter, 4);

    const attempted = new Set([...run1.batch, ...run2.batch, ...run3.batch]);
    const stillUncovered = REGISTER.filter((n) => !covered.has(n));
    for (const name of stillUncovered) {
      expect(attempted.has(name)).toBe(true);
    }
  });

  it("wraps to the start of the list when fewer than `size` candidates remain after the cursor", () => {
    const { batch, nextAfter } = selectProbeBatch(["a", "b", "c", "d", "e"], new Set(), "c", 4);
    // Only d, e sort after "c" — wraps to also take a, b.
    expect(batch).toEqual(["d", "e", "a", "b"]);
    expect(nextAfter).toBe("b");
  });

  it("wraps to the start when the cursor is stale/beyond the last name in the list", () => {
    const { batch, nextAfter } = selectProbeBatch(["a", "b", "c"], new Set(), "zzz", 2);
    expect(batch).toEqual(["a", "b"]);
    expect(nextAfter).toBe("b");
  });

  it("excludes covered names from the candidate pool entirely", () => {
    const { batch } = selectProbeBatch(["a", "b", "c", "d"], new Set(["b", "c"]), "", 10);
    expect(batch).toEqual(["a", "d"]);
  });

  it("returns an empty batch and leaves the cursor unchanged when every name is covered", () => {
    expect(selectProbeBatch(["a", "b"], new Set(["a", "b"]), "x", 10)).toEqual({
      batch: [],
      nextAfter: "x",
    });
  });
});

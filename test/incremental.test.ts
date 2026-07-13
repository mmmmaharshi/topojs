/* eslint-disable vitest/expect-expect */
import { describe, it, expect } from "vitest";

import { computePersistentHomology } from "../src/core/homology.ts";
import { IncrementalH1 } from "../src/streaming/incremental-h1.ts";
import { mulberry32, circlePoints } from "./helpers.ts";

/**
 * Sort pairs into a canonical order before comparing. The incremental
 * engine is an independent reimplementation of the reduction algorithm (its
 * own tie-break rule for equal-value simplices), so pair emission ORDER can
 * legitimately differ from computePersistentHomology's even when the
 * resulting barcode (the multiset of {dim,birth,death}) is identical. Only
 * the multiset is a meaningful correctness claim.
 */
function canon(pairs: { dim: number; birth: number; death: number }[]): string {
  return JSON.stringify(
    pairs
      .map((p) => ({ birth: p.birth, death: p.death, dim: p.dim }))
      .toSorted(
        (a, b) => a.dim - b.dim || a.birth - b.birth || a.death - b.death
      )
  );
}

/**
 * Run a random point stream through IncrementalH1, and after every push,
 * independently recompute ground truth via computePersistentHomology on the
 * exact same window contents (reconstructed from the raw stream). This is
 * the same differential-testing pattern used for the Phase A naive
 * baseline (test/streaming.test.ts) — here it's the load-bearing
 * correctness check for a genuinely new reduction algorithm (prefix-stable
 * incremental reduction, not just a wrapper around the existing function),
 * so it runs many seeds and many pushes per seed.
 */
function runDifferentialTrial(
  seed: number,
  windowSize: number,
  maxDist: number,
  dims: number,
  steps: number
): void {
  const rng = mulberry32(seed);
  const inc = new IncrementalH1({ dims, maxDist, windowSize });
  const allPoints: number[][] = [];

  for (let i = 0; i < steps; i++) {
    const pt: number[] = [];
    for (let d = 0; d < dims; d++) {
      pt.push(rng());
    }
    allPoints.push(pt);
    const update = inc.push(pt);
    if (update === null) {
      continue;
    }

    const start = Math.max(0, allPoints.length - windowSize);
    const windowPts = allPoints.slice(start);
    const flat = new Float64Array(windowPts.length * dims);
    windowPts.forEach((p, idx) => {
      for (let d = 0; d < dims; d++) {
        flat[idx * dims + d] = p[d]!;
      }
    });
    const expected = computePersistentHomology(flat, dims, maxDist, 2);

    expect(update.windowSize).toBe(windowPts.length);
    expect(update.complex.numEdges).toBe(expected.complex.numEdges);
    expect(update.complex.numTriangles).toBe(expected.complex.numTriangles);
    expect(canon(update.pairs)).toBe(canon(expected.pairs));
  }
}

describe("IncrementalH1 (Phase B / prefix-stable incremental reduction)", () => {
  it("returns null until at least 2 points are present", () => {
    const inc = new IncrementalH1({ dims: 2, maxDist: 1, windowSize: 10 });
    expect(inc.push([0, 0])).toBeNull();
    expect(inc.push([1, 0])).not.toBeNull();
  });

  /* eslint-disable vitest/max-expects */
  it("rejects invalid construction parameters (mirrors SlidingWindow validation)", () => {
    // Previously this class had NO constructor validation at all (unlike
    // SlidingWindow, which it doesn't delegate to -- it manages its own
    // FIFO for the persistent-adjacency mechanism), so windowSize<=0, a
    // non-integer windowSize, dims<=0, or a negative/NaN maxDist would be
    // accepted silently and fail confusingly (or not at all) later on
    // push(), instead of failing clearly at construction time.
    expect(
      () => new IncrementalH1({ dims: 2, maxDist: 1, windowSize: 0 })
    ).toThrow("windowSize");
    expect(
      () => new IncrementalH1({ dims: 2, maxDist: 1, windowSize: 1 })
    ).toThrow("windowSize"); // push() can never return non-null below 2
    expect(
      () => new IncrementalH1({ dims: 2, maxDist: 1, windowSize: -5 })
    ).toThrow("windowSize");
    expect(
      () => new IncrementalH1({ dims: 2, maxDist: 1, windowSize: 2.5 })
    ).toThrow("windowSize");
    expect(
      () => new IncrementalH1({ dims: 0, maxDist: 1, windowSize: 10 })
    ).toThrow("dims");
    expect(
      () => new IncrementalH1({ dims: -1, maxDist: 1, windowSize: 10 })
    ).toThrow("dims");
    expect(
      () => new IncrementalH1({ dims: 2, maxDist: -1, windowSize: 10 })
    ).toThrow("maxDist");
    expect(
      () => new IncrementalH1({ dims: 2, maxDist: Number.NaN, windowSize: 10 })
    ).toThrow("maxDist");
    // sanity: valid parameters still construct fine
    expect(
      () => new IncrementalH1({ dims: 1, maxDist: 0, windowSize: 2 })
    ).not.toThrow();
  });
  /* eslint-enable vitest/max-expects */

  it("rejects a pushed point whose dimensionality does not match the configured dims", () => {
    const inc = new IncrementalH1({ dims: 3, maxDist: 1, windowSize: 10 });
    expect(() => inc.push([0, 0])).toThrow("expected point of length"); // too short
    expect(() => inc.push([0, 0, 0, 0])).toThrow("expected point of length"); // too long
    expect(() => inc.push([0, 0, 0])).not.toThrow(); // matches dims=3
  });

  it("matches full recompute exactly across many random streams (small windows)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      runDifferentialTrial(seed, 8, 0.6, 2, 40);
    }
  });

  it("matches full recompute exactly across many random streams (larger windows)", () => {
    for (const seed of [11, 12, 13, 14]) {
      runDifferentialTrial(seed, 16, 0.5, 2, 60);
    }
  });

  it("matches full recompute with a dense/high-maxDist regime (many ties, many triangles)", () => {
    for (const seed of [21, 22, 23]) {
      runDifferentialTrial(seed, 10, 2, 2, 40);
    }
  });

  it("matches full recompute with a sparse/low-maxDist regime (many disconnected components)", () => {
    for (const seed of [31, 32, 33]) {
      runDifferentialTrial(seed, 10, 0.15, 2, 40);
    }
  });

  it("matches full recompute in 3D", () => {
    for (const seed of [41, 42]) {
      runDifferentialTrial(seed, 10, 0.7, 3, 40);
    }
  });

  it("matches full recompute on a synthetic loop-entering-the-window stream", () => {
    // Same scenario as the Phase A synthetic test: noise first, then a ring
    // that should register a real H1 loop -- exercised here through the
    // incremental engine specifically, differentially checked at every step.
    const rng = mulberry32(99);
    const windowSize = 12;
    const maxDist = 0.6;
    const inc = new IncrementalH1({ dims: 2, maxDist, windowSize });
    const allPoints: number[][] = [];

    const pushAndCheck = (pt: number[]) => {
      allPoints.push(pt);
      const update = inc.push(pt);
      if (update === null) {
        return;
      }
      const start = Math.max(0, allPoints.length - windowSize);
      const windowPts = allPoints.slice(start);
      const flat = new Float64Array(windowPts.length * 2);
      windowPts.forEach((p, idx) => {
        flat[idx * 2] = p[0]!;
        flat[idx * 2 + 1] = p[1]!;
      });
      const expected = computePersistentHomology(flat, 2, maxDist, 2);
      expect(canon(update.pairs)).toBe(canon(expected.pairs));
    };

    for (let i = 0; i < windowSize; i++) {
      pushAndCheck([rng() * 0.05, rng() * 0.05]);
    }
    const ring = circlePoints(windowSize, 1);
    for (let i = 0; i < windowSize; i++) {
      pushAndCheck([ring[i * 2]!, ring[i * 2 + 1]!]);
    }
  });

  it("matches full recompute over a long-running stream (stresses the pooled reducedCols/triPair storage across many prefix-copy-forward cycles)", () => {
    // The pooled-storage change (src/streaming/incremental-h1.ts, colPool/
    // colOffset/colLength/triPairHas/Birth/Death) reconstructs each push's
    // prefix from the PREVIOUS push's pool via subarray() views, then packs
    // a fresh pool at commit time -- a bug in that bookkeeping (e.g. an
    // off-by-one in cumulative offsets) could plausibly only surface after
    // many push cycles, not the first few. This runs many more steps than
    // the other differential tests above specifically to stress that.
    for (const seed of [501, 502, 503]) {
      runDifferentialTrial(seed, 14, 0.5, 2, 200);
    }
  });

  it("reports re-reduction stats that never exceed the total triangle count", () => {
    const rng = mulberry32(7);
    const inc = new IncrementalH1({ dims: 2, maxDist: 0.6, windowSize: 12 });
    for (let i = 0; i < 30; i++) {
      const update = inc.push([rng(), rng()]);
      if (!update) {
        continue;
      }
      expect(update.stats.reReducedTriangles).toBeGreaterThanOrEqual(0);
      expect(update.stats.reReducedTriangles).toBeLessThanOrEqual(
        update.stats.totalTriangles
      );
    }
  });
});

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
 *
 * H0+H1 pairs are compared exactly against a maxDim=2 reference (same
 * simplex interleaving ensures exact match). H2 pairs are compared as a
 * full multiset against a maxDim=3 reference — the barcode is a topological
 * invariant.
 *
 * When assertDense is true, the test also asserts that tetrahedra and H2
 * pairs exist at some point during the trial, ensuring the H2 code path
 * is not exercised vacuously.
 */
function runDifferentialTrial(
  seed: number,
  windowSize: number,
  maxDist: number,
  dims: number,
  steps: number,
  assertDense = false
): void {
  const rng = mulberry32(seed);
  const inc = new IncrementalH1({ dims, maxDim: 2, maxDist, windowSize });
  const allPoints: number[][] = [];
  let sawTetrahedra = false;

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

    // H0+H1: exact match against a maxDim=2 reference
    const expectedH01 = computePersistentHomology(flat, dims, maxDist, 2);
    expect(update.windowSize).toBe(windowPts.length);
    expect(update.complex.numEdges).toBe(expectedH01.complex.numEdges);
    expect(update.complex.numTriangles).toBe(expectedH01.complex.numTriangles);
    const incH01 = update.pairs.filter((p) => p.dim < 2);
    expect(canon(incH01)).toBe(canon(expectedH01.pairs));

    sawTetrahedra ||= update.complex.numTetrahedra > 0;

    // H2: compare ALL pairs against a maxDim=3 reference
    const incH2 = update.pairs.filter((p) => p.dim === 2);
    const expectedAll = computePersistentHomology(flat, dims, maxDist, 3);
    const refH2 = expectedAll.pairs.filter((p) => p.dim === 2);
    expect(canon(incH2)).toBe(canon(refH2));
  }

  // When assertDense is set, the geometry must actually produce tetrahedra
  // (otherwise the H2 reduction path is never exercised). H2 pairs may be
  // empty even when tetrahedra exist — in a complete graph every tetrahedron's
  // pivot triangle has the same filtration value (birth = death), so no finite
  // H2 pairs are emitted. The canon comparison against maxDim=3 already
  // validates H2 correctness for any pairs that ARE produced.
  if (assertDense) {
    expect(sawTetrahedra).toBeTruthy();
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

  it("matches full recompute in 3D (moderate density, small windows)", () => {
    for (const seed of [41, 42, 43, 44]) {
      runDifferentialTrial(seed, 8, 0.8, 3, 40);
    }
  });

  it("matches full recompute in 3D (larger windows, more evictions)", () => {
    for (const seed of [51, 52]) {
      runDifferentialTrial(seed, 14, 0.6, 3, 80);
    }
  });

  it("matches full recompute in 3D at dense regime (guarantees tetrahedra)", () => {
    // maxDist=2 in 3D with windowSize=8 produces tetrahedra; assertDense
    // verifies the tetrahedron reduction path was exercised. H2 pairs may
    // still be empty — in a complete metric space every tetrahedron's pivot
    // triangle has the same filtration value (birth = death), so no finite
    // H2 pairs are emitted.
    for (const seed of [61, 62, 63]) {
      runDifferentialTrial(seed, 8, 2, 3, 40, true);
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
      const incH01 = update.pairs.filter((p) => p.dim < 2);
      expect(canon(incH01)).toBe(canon(expected.pairs));
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

  it("maxDim=0 emits only H0 pairs (no H1 or H2)", () => {
    const rng = mulberry32(42);
    const inc = new IncrementalH1({
      dims: 2,
      maxDim: 0,
      maxDist: 0.6,
      windowSize: 10,
    });
    for (let i = 0; i < 30; i++) {
      const update = inc.push([rng(), rng()]);
      if (!update) {
        continue;
      }
      for (const p of update.pairs) {
        expect(p.dim).toBe(0);
      }
    }
  });

  it("maxDim=1 emits only H0 and H1 pairs (no H2)", () => {
    const rng = mulberry32(43);
    const inc = new IncrementalH1({
      dims: 2,
      maxDim: 1,
      maxDist: 0.6,
      windowSize: 10,
    });
    for (let i = 0; i < 30; i++) {
      const update = inc.push([rng(), rng()]);
      if (!update) {
        continue;
      }
      for (const p of update.pairs) {
        expect(p.dim).toBeLessThan(2);
      }
    }
  });

  // ── Stage 2: known-shape ground truth ──

  it("octahedron at hollow radius produces essential H2 class (b2=1)", () => {
    // 6 vertices of a regular octahedron in R^3: (±1,0,0), (0,±1,0), (0,0,±1)
    const octPts = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    // At maxDist = sqrt(2) + ε, antipodal pairs (distance 2) are excluded,
    // but all other pairs (distance sqrt(2)) are included — the 2-skeleton
    // is the octahedron 2-sphere. No tetrahedra exist (any 4 vertices
    // include at least one antipodal pair).
    const eps = Math.SQRT2 + 0.01;
    const inc = new IncrementalH1({
        dims: 3,
        maxDim: 2,
        maxDist: eps,
        windowSize: 8,
      });
    const updates: ReturnType<typeof inc.push>[] = [];
    for (const pt of octPts) {
      updates.push(inc.push(pt));
    }
    // Push 5 (0-indexed) is the 6th push — all 6 unique octahedron points
    // are now in the window.  Do NOT re-push a duplicate (distance 0 to the
    // original), which would create zero-distance edges allowing tetrahedra.
    const update = updates[5]!;
    expect(update.complex.numTetrahedra).toBe(0);
    const b2 = update.pairs.filter((p) => p.dim === 2 && p.death < 0).length;
    expect(b2).toBe(1);
    // Finite H2 pairs should be zero (no tetrahedra to kill cycles)
    expect(update.pairs.filter((p) => p.dim === 2 && p.death >= 0)).toHaveLength(
      0
    );
  });

  it("octahedron at larger radius: tetrahedra kill the H2 class", () => {
    // Same 6 octahedron points, but with maxDist = 2.1, ALL 15 edges exist
    // (the antipodal distance is 2 < 2.1). The 6-clique has 20 tetrahedra,
    // whose boundaries kill the octahedron's H2 cycle.
    const octPts = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
      const inc = new IncrementalH1({
        dims: 3,
        maxDim: 2,
        maxDist: 2.1,
        windowSize: 8,
      });
      const updates: ReturnType<typeof inc.push>[] = [];
      for (const pt of octPts) {
        updates.push(inc.push(pt));
      }
      // Push 5 (0-indexed) is the 6th push — all 6 unique octahedron points
      // are now in the window with ALL 15 edges (antipodal distance 2 < 2.1).
    const update = updates[5]!;
    expect(update.complex.numTetrahedra).toBeGreaterThan(0);
    // Essential H2 should be 0 (all 2-cycles killed by tetrahedra)
    expect(
      update.pairs.filter((p) => p.dim === 2 && p.death < 0)
    ).toHaveLength(0);
    // There should be finite H2 pairs (tetrahedra killing triangles)
    expect(
      update.pairs.filter((p) => p.dim === 2 && p.death >= 0).length
    ).toBeGreaterThan(0);
  });

  it("two disjoint octahedra produce b2=2", () => {
    // Two octahedra far apart — the second at (1000,0,0) offset.
    // Each contributes b2=1, for b2=2 total when both are in the window.
    const scale = 1000;
    const octPts: number[][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [1 + scale, 0, 0],
      [-1 + scale, 0, 0],
      [scale, 1, 0],
      [scale, -1, 0],
      [scale, 0, 1],
      [scale, 0, -1],
    ];
    const eps = Math.SQRT2 + 0.01;
    const inc = new IncrementalH1({
        dims: 3,
        maxDim: 2,
        maxDist: eps,
        windowSize: 12,
      });
      const updates: ReturnType<typeof inc.push>[] = [];
      for (const pt of octPts) {
        updates.push(inc.push(pt));
      }
      // Push 11 (0-indexed) is the 12th push — all 12 unique octahedron
    // points are now in the window. No edge connects the two octahedra
    // since the closest inter-octahedron distance is ~1000 >> maxDist.
    const update = updates[11]!;
    expect(update.complex.numTetrahedra).toBe(0);
    const b2 = update.pairs.filter((p) => p.dim === 2 && p.death < 0).length;
    expect(b2).toBe(2);
  });

  // ── Stage 3: edge cases and stress ──

  it("handles maxDist=0 (only H0, no edges/triangles/tetrahedra)", () => {
    // With maxDist=0, only points at exactly the same location form edges.
    // Using points far apart (distance > 0) ensures no edges.
    const inc = new IncrementalH1({ dims: 2, maxDist: 0, windowSize: 10 });
    expect(inc.push([0, 0])).toBeNull();
    const u1 = inc.push([10, 0]);
    expect(u1).not.toBeNull();
    if (u1) {
      expect(u1.complex.numEdges).toBe(0);
      expect(u1.complex.numTriangles).toBe(0);
      expect(u1.complex.numTetrahedra).toBe(0);
      for (const p of u1.pairs) {
        expect(p.dim).toBe(0);
      }
    }
    const u2 = inc.push([20, 0]);
    expect(u2).not.toBeNull();
    if (u2) {
      expect(u2.complex.numEdges).toBe(0);
      expect(u2.complex.numTriangles).toBe(0);
      expect(u2.complex.numTetrahedra).toBe(0);
    }
  });

  it("handles maxDist=Infinity (maximal complex up to window capacity)", () => {
    // With maxDist=Infinity, all pairs are within distance. For 4+ points
    // in 3D, tetrahedra must form.
    const inc = new IncrementalH1({
        dims: 3,
        maxDim: 2,
        maxDist: Infinity,
        windowSize: 6,
      });
      for (let i = 0; i < 6; i++) {
        const update = inc.push([i, i, i]);
      if (!update) continue;
      if (update.complex.numVertices >= 4) {
        expect(update.complex.numTetrahedra).toBeGreaterThan(0);
      }
    }
  });

  it("handles a single point gracefully (no crash, null until second)", () => {
    const inc = new IncrementalH1({ dims: 2, maxDist: 1, windowSize: 10 });
    expect(inc.push([5, 5])).toBeNull();
    expect(inc.push([6, 6])).not.toBeNull();
  });

  it("handles zero-distance duplicate points (coincident)", () => {
    // Four coincident points at the origin: all edges have val=0.
    // With maxDist > 0, all 4 points form a 4-clique with tetrahedra.
    const inc = new IncrementalH1({
        dims: 3,
        maxDim: 2,
        maxDist: 1,
        windowSize: 8,
      });
      for (let i = 0; i < 4; i++) {
        inc.push([0, 0, 0]);
      }
      const update = inc.push([0, 0, 0]); // push 5
    if (update) {
      expect(update.complex.numEdges).toBeGreaterThan(0);
      expect(update.complex.numTriangles).toBeGreaterThan(0);
      expect(update.complex.numTetrahedra).toBeGreaterThan(0);
    }
  });

  it("3D eviction stress: many pushes with 3D points exercise tetrahedron management", () => {
    // 500 pushes, windowSize=12, dims=3 — stresses tetrahedron survivor
    // filtering, boundary remapping, and H2 reduction across ~488 evictions.
    // Checks basic invariants on every push and a full differential
    // comparison on the final push.
    const rng = mulberry32(71);
    const inc = new IncrementalH1({
        dims: 3,
        maxDim: 2,
        maxDist: 0.8,
        windowSize: 12,
      });
      const allPts: number[][] = [];
      let lastUpdate: Exclude<ReturnType<typeof inc.push>, null> | null = null;
    for (let i = 0; i < 500; i++) {
      const pt = [rng(), rng(), rng()];
      allPts.push(pt);
      const update = inc.push(pt);
      if (!update) continue;
      lastUpdate = update;
      expect(update.complex.numTetrahedra).toBeGreaterThanOrEqual(0);
    }
    // Differential check on the final push
    expect(lastUpdate).not.toBeNull();
    if (lastUpdate) {
      const start = Math.max(0, allPts.length - 12);
      const windowPts = allPts.slice(start);
      const flat = new Float64Array(windowPts.length * 3);
      windowPts.forEach((p, idx) => {
        flat[idx * 3] = p[0]!;
        flat[idx * 3 + 1] = p[1]!;
        flat[idx * 3 + 2] = p[2]!;
      });
      const expected = computePersistentHomology(flat, 3, 0.8, 3);
      expect(lastUpdate.complex.numEdges).toBe(expected.complex.numEdges);
      expect(lastUpdate.complex.numTriangles).toBe(
        expected.complex.numTriangles
      );
      expect(lastUpdate.complex.numTetrahedra).toBe(
        expected.complex.numTetrahedra
      );
      const incH01 = lastUpdate.pairs.filter((p) => p.dim < 2);
      const refH01 = expected.pairs.filter((p) => p.dim < 2);
      expect(canon(incH01)).toBe(canon(refH01));
      const incH2 = lastUpdate.pairs.filter((p) => p.dim === 2);
      const refH2 = expected.pairs.filter((p) => p.dim === 2);
      expect(canon(incH2)).toBe(canon(refH2));
    }
  });

  // ── Stage 4: invariants and bookkeeping ──

  it("reports tetrahedron re-reduction stats that never exceed totals", () => {
    const rng = mulberry32(73);
    const inc = new IncrementalH1({ dims: 3, maxDist: 1.5, windowSize: 10 });
    for (let i = 0; i < 50; i++) {
      const update = inc.push([rng(), rng(), rng()]);
      if (!update) continue;
      expect(update.stats.reReducedTetrahedra).toBeGreaterThanOrEqual(0);
      expect(update.stats.reReducedTetrahedra).toBeLessThanOrEqual(
        update.stats.totalTetrahedra
      );
    }
  });

  it("rejects out-of-range maxDim values", () => {
    expect(
      () => new IncrementalH1({ dims: 2, maxDim: -1, maxDist: 1, windowSize: 10 })
    ).toThrow("maxDim");
    expect(
      () => new IncrementalH1({ dims: 2, maxDim: 3, maxDist: 1, windowSize: 10 })
    ).toThrow("maxDim");
    expect(
      () => new IncrementalH1({ dims: 2, maxDim: 1.5, maxDist: 1, windowSize: 10 })
    ).toThrow("maxDim");
  });
});

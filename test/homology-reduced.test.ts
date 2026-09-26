/* eslint-disable vitest/expect-expect */
import { describe, expect, it } from "vitest";

import { computePersistentHomologyReduced } from "../src/core/homology-reduced.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { referenceRipsBarcode } from "./barcode-reference.ts";
import {
  bruteForceEdgeCount,
  bruteForceTriangleCount,
  circlePoints,
  generatePoints,
  mulberry32,
  samePersistencePairs,
} from "./helpers.ts";

/**
 * computePersistentHomologyReduced only computes H0+H1 (see its docstring
 * for why -- it matches the source paper's own degree-1-only scope), so the
 * ground truth here is computePersistentHomology's OUTPUT FILTERED to
 * dim<=1, not its full H0+H1+H2 result.
 */
function checkMatchesMode(
  points: Float64Array,
  maxDist: number,
  dims = 2,
  collapse = false
): void {
  const context = `dims=${dims} maxDist=${maxDist} collapse=${collapse}`;
  const expectedFull = computePersistentHomology(points, dims, maxDist, 1);
  const actual = computePersistentHomologyReduced(
    points,
    dims,
    maxDist,
    collapse
  );
  expect(actual.complex.numVertices, `${context}: vertex count`).toBe(
    expectedFull.complex.numVertices
  );
  const fullEdgeCount = bruteForceEdgeCount(points, dims, maxDist);
  if (collapse) {
    expect(
      actual.complex.numEdges,
      `${context}: collapsed edge count`
    ).toBeLessThanOrEqual(fullEdgeCount);
  } else {
    expect(actual.complex.numEdges, `${context}: edge count`).toBe(
      fullEdgeCount
    );
  }
  const expectedPairs =
    points.length / dims <= 8
      ? referenceRipsBarcode(points, dims, maxDist, 1)
      : expectedFull.pairs.filter((p) => p.dim <= 1);
  expect(
    samePersistencePairs(actual.pairs, expectedPairs),
    `${context}: H0+H1 pairs`
  ).toBeTruthy();
}

function checkMatches(points: Float64Array, maxDist: number, dims = 2): void {
  checkMatchesMode(points, maxDist, dims, false);
  checkMatchesMode(points, maxDist, dims, true);
}

describe("computePersistentHomologyReduced (reduced VR complex) vs. independent reference and production fallback (H0+H1 only)", () => {
  it("matches the default path when collapse is requested", () => {
    const points = new Float64Array([1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1]);
    const expected = computePersistentHomologyReduced(points, 3, 3);
    const actual = computePersistentHomologyReduced(points, 3, 3, true);
    expect(samePersistencePairs(actual.pairs, expected.pairs)).toBeTruthy();
    expect(actual.complex.numEdges).toBe(3);
  });

  it("uses shifted edge values for collapsed triangles", () => {
    const points = new Float64Array([
      0.23645552527159452, 0.3692706737201661, 0.5042420323006809,
      0.7048832636792213, 0.05054362863302231, 0.3695183543022722,
      0.7747629624791443, 0.556188570568338, 0.0164932357147336,
      0.6392460397910327, 0.2504511415027082, 0.4223777682054788,
      0.5906901974231005, 0.8369336591567844, 0.23507591942325234,
      0.980845961952582,
    ]);
    const actual = computePersistentHomologyReduced(points, 2, 0.7, true);
    const expected = computePersistentHomology(points, 2, 0.7, 1);
    expect(samePersistencePairs(actual.pairs, expected.pairs)).toBeTruthy();
  });

  it("matches on random point clouds across many seeds, densities, and maxDist values", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed);
      const n = 15 + (seed % 12);
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        pts.push([rng(), rng()]);
      }
      const flat = generatePoints(pts);
      for (const maxDist of [
        0.15,
        0.3,
        0.5,
        0.8,
        1.5,
        Number.POSITIVE_INFINITY,
      ]) {
        checkMatches(flat, maxDist);
      }
    }
  });

  it("matches in 3D across many seeds", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed * 17 + 3);
      const n = 12 + (seed % 8);
      const pts: number[] = [];
      for (let i = 0; i < n * 3; i++) {
        pts.push(rng());
      }
      for (const maxDist of [0.4, 0.7, 1.2, Number.POSITIVE_INFINITY]) {
        checkMatches(new Float64Array(pts), maxDist, 3);
      }
    }
  });

  it("matches in higher dimensions (5D, where doubling-dimension bound is looser)", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const rng = mulberry32(seed * 41 + 5);
      const n = 12 + (seed % 6);
      const pts: number[] = [];
      for (let i = 0; i < n * 5; i++) {
        pts.push(rng());
      }
      for (const maxDist of [0.8, 1.4, Number.POSITIVE_INFINITY]) {
        checkMatches(new Float64Array(pts), maxDist, 5);
      }
    }
  });

  it("matches on a circle (essential H1 class present)", () => {
    for (const n of [8, 12, 16, 24, 32]) {
      const pts = circlePoints(n, 1);
      for (const maxDist of [0.35, 0.9, 1.5]) {
        checkMatches(pts, maxDist);
      }
    }
  });

  it("matches on tie-heavy grid point clouds (2D) -- many equal-distance lunes/components", () => {
    for (const size of [3, 4, 5, 6]) {
      const pts: [number, number][] = [];
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          pts.push([i, j]);
        }
      }
      const flat = generatePoints(pts);
      for (const maxDist of [1, 1.5, Math.SQRT2 + 0.01, 2.5, 3]) {
        checkMatches(flat, maxDist);
      }
    }
  });

  it("matches on tie-heavy 3D grids -- exercises heavy lune/component sharing", () => {
    for (const size of [3, 4]) {
      const pts: number[] = [];
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          for (let k = 0; k < 2; k++) {
            pts.push(i, j, k);
          }
        }
      }
      for (const maxDist of [1, 1.5, 2, 2.5]) {
        checkMatches(new Float64Array(pts), maxDist, 3);
      }
    }
  });

  it("matches on a 1D lattice (extreme tie density, every lune massively overlapping)", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 15; i++) {
      pts.push([i, 0]);
    }
    const flat = generatePoints(pts);
    for (const maxDist of [1, 2, 3, 5, 14]) {
      checkMatches(flat, maxDist);
    }
  });

  it("matches on sparse/disconnected configurations (small maxDist, mostly-empty lunes)", () => {
    const rng = mulberry32(77);
    const pts: [number, number][] = [];
    for (let i = 0; i < 30; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    checkMatches(flat, 0.1);
  });

  it("matches above the spatial-grid crossover with a finite cutoff", () => {
    const size = 27;
    const points: [number, number][] = [];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        points.push([i, j]);
      }
    }
    const flat = generatePoints(points);
    const actual = computePersistentHomologyReduced(flat, 2, 1.1);
    const collapsed = computePersistentHomologyReduced(flat, 2, 1.1, true);
    const expected = computePersistentHomology(flat, 2, 1.1, 1);
    const fullEdgeCount = bruteForceEdgeCount(flat, 2, 1.1);
    expect(actual.complex.numEdges, "grid edge count").toBe(fullEdgeCount);
    expect(
      collapsed.complex.numEdges,
      "collapsed grid edge count"
    ).toBeLessThanOrEqual(fullEdgeCount);
    expect(
      samePersistencePairs(actual.pairs, expected.pairs),
      "grid H0+H1 pairs"
    ).toBeTruthy();
    expect(
      samePersistencePairs(collapsed.pairs, expected.pairs),
      "collapsed grid H0+H1 pairs"
    ).toBeTruthy();
  });

  it("matches on a larger dense cloud", () => {
    const rng = mulberry32(4242);
    const n = 70;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    for (const maxDist of [0.2, 0.5, Number.POSITIVE_INFINITY]) {
      checkMatches(flat, maxDist);
    }
  });

  it("handles n<=2 (no possible triangles) and other degenerate small clouds", () => {
    checkMatches(generatePoints([[0, 0]]), 1);
    checkMatches(
      generatePoints([
        [0, 0],
        [1, 0],
      ]),
      1
    );
    checkMatches(
      generatePoints([
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
      0.1
    ); // maxDist too small for any edges
  });

  it("reduces the triangle count relative to the full complex on a moderately dense cloud (sanity check that the construction is actually doing something, not just correct-but-inert)", () => {
    const rng = mulberry32(999);
    const n = 60;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    const full = computePersistentHomology(
      flat,
      2,
      Number.POSITIVE_INFINITY,
      2 // H1 (not 1): the maxDim<2 cost gate skips collapse, which would make
      // numTriangles the uncollapsed count and void the comparison below
    );
    // The collapsed builder no longer reports the full triangle count, so
    // the reduced construction is measured against an independent
    // brute-force count of the uncollapsed flag complex's triangles.
    const fullTriangles = bruteForceTriangleCount(
      flat,
      2,
      Number.POSITIVE_INFINITY
    );
    expect(fullTriangles).toBeGreaterThan(full.complex.numTriangles);
    const reduced = computePersistentHomologyReduced(
      flat,
      2,
      Number.POSITIVE_INFINITY
    );
    expect(reduced.complex.numTriangles).toBeLessThan(fullTriangles);
    // Not a tight bound (Lemma 3.9's 4^D is famously crude), just a sanity
    // check that the reduction is substantial, not marginal, at this n/D.
    expect(reduced.complex.numTriangles).toBeLessThan(fullTriangles * 0.5);
  });
});

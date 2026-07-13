/* eslint-disable vitest/expect-expect */
import { describe, expect, it } from "vitest";

import { computePersistentHomologyReduced } from "../src/core/homology-reduced.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { circlePoints, generatePoints, mulberry32 } from "./helpers.ts";

/**
 * Canonicalize pairs before comparing: computePersistentHomologyReduced
 * builds a different (smaller) triangle set than computePersistentHomology,
 * so pair emission order can legitimately differ even when the resulting
 * barcode (multiset of {dim,birth,death}) is identical. Only the multiset is
 * a meaningful correctness claim -- same convention as the other
 * differential-testing suites in this repo (homology-cohom.test.ts et al.).
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
 * computePersistentHomologyReduced only computes H0+H1 (see its docstring
 * for why -- it matches the source paper's own degree-1-only scope), so the
 * ground truth here is computePersistentHomology's OUTPUT FILTERED to
 * dim<=1, not its full H0+H1+H2 result.
 */
function checkMatches(points: Float64Array, maxDist: number, dims = 2): void {
  const expectedFull = computePersistentHomology(points, dims, maxDist, 1);
  const actual = computePersistentHomologyReduced(points, dims, maxDist);
  expect(actual.complex.numVertices).toBe(expectedFull.complex.numVertices);
  expect(actual.complex.numEdges).toBe(expectedFull.complex.numEdges);
  expect(canon(actual.pairs)).toBe(
    canon(expectedFull.pairs.filter((p) => p.dim <= 1))
  );
}

describe("computePersistentHomologyReduced (reduced VR complex) vs. computePersistentHomology (ground truth, H0+H1 only)", () => {
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
      1
    );
    const reduced = computePersistentHomologyReduced(
      flat,
      2,
      Number.POSITIVE_INFINITY
    );
    expect(reduced.complex.numTriangles).toBeLessThan(
      full.complex.numTriangles
    );
    // Not a tight bound (Lemma 3.9's 4^D is famously crude), just a sanity
    // check that the reduction is substantial, not marginal, at this n/D.
    expect(reduced.complex.numTriangles).toBeLessThan(
      full.complex.numTriangles * 0.5
    );
  });
});

/* eslint-disable vitest/expect-expect */
import { describe, it, expect } from "vitest";

import { computePersistentHomologyImplicit } from "../src/core/homology-implicit.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { mulberry32, circlePoints, countByDim } from "./helpers.ts";

function canon(pairs: { dim: number; birth: number; death: number }[]): string {
  return JSON.stringify(
    pairs
      .map((p) => ({ birth: p.birth, death: p.death, dim: p.dim }))
      .toSorted(
        (a, b) => a.dim - b.dim || a.birth - b.birth || a.death - b.death
      )
  );
}

function checkMatches(
  points: Float64Array,
  dims: number,
  maxDist: number,
  maxDim: number
): void {
  const expected = computePersistentHomology(points, dims, maxDist, maxDim);
  const actual = computePersistentHomologyImplicit(
    points,
    dims,
    maxDist,
    maxDim
  );
  expect(canon(actual.pairs)).toBe(canon(expected.pairs));
}

function randomPoints(
  rng: () => number,
  n: number,
  dims: number
): Float64Array {
  const pts = new Float64Array(n * dims);
  for (let i = 0; i < n * dims; i++) {
    pts[i] = rng() * 10;
  }
  return pts;
}

describe("computePersistentHomologyImplicit vs computePersistentHomology (ground truth)", () => {
  it("matches on 1000 random point clouds, varied n/dims/maxDist (H0+H1)", () => {
    const seeds = Array.from({ length: 1000 }, (_, i) => i * 17 + 3);
    for (const seed of seeds) {
      const rng = mulberry32(seed);
      const n = 3 + Math.floor(rng() * 28);
      const dims = 2 + Math.floor(rng() * 4);
      const pts = randomPoints(rng, n, dims);
      const maxDistCandidates = [0.5, 1, 2, 3, 5, 8, Infinity];
      const maxDist =
        maxDistCandidates[Math.floor(rng() * maxDistCandidates.length)]!;
      checkMatches(pts, dims, maxDist, 2);
    }
  });

  it("matches on 500 random point clouds, varied n/dims/maxDist (H0+H1+H2)", () => {
    const seeds = Array.from({ length: 500 }, (_, i) => i * 13 + 7);
    for (const seed of seeds) {
      const rng = mulberry32(seed);
      const n = 4 + Math.floor(rng() * 27);
      const dims = 2 + Math.floor(rng() * 4);
      const pts = randomPoints(rng, n, dims);
      const maxDistCandidates = [0.5, 1, 2, 3, 5, 8, Infinity];
      const maxDist =
        maxDistCandidates[Math.floor(rng() * maxDistCandidates.length)]!;
      checkMatches(pts, dims, maxDist, 3);
    }
  });

  it("maxDist = 0: no edges, only isolated vertices", () => {
    const pts = randomPoints(mulberry32(0), 10, 2);
    checkMatches(pts, 2, 0, 2);
    checkMatches(pts, 2, 0, 3);
  });

  it("maxDist = Infinity (complete graph), small n", () => {
    for (const n of [3, 4, 5, 6]) {
      const pts = randomPoints(mulberry32(n), n, 2);
      checkMatches(pts, 2, Infinity, 2);
      checkMatches(pts, 2, Infinity, 3);
    }
  });

  it("coincident points (degenerate distances = 0)", () => {
    const pts = new Float64Array([0, 0, 0, 0, 0, 0]);
    checkMatches(pts, 2, Infinity, 2);
    checkMatches(pts, 2, Infinity, 3);
  });

  it("n < 4: not enough points for any tetrahedra", () => {
    const pts = randomPoints(mulberry32(7), 3, 2);
    checkMatches(pts, 2, Infinity, 2);
    checkMatches(pts, 2, Infinity, 3);
  });

  it("single point", () => {
    const pts = new Float64Array([1, 1]);
    checkMatches(pts, 2, Infinity, 2);
    checkMatches(pts, 2, Infinity, 3);
  });

  it("circle points: exactly one H1 bar", () => {
    for (const n of [8, 12, 16, 24]) {
      const pts = circlePoints(n, 1);
      const chord = 2 * Math.sin(Math.PI / n);
      const res = computePersistentHomologyImplicit(pts, 2, chord + 0.01, 2);
      const expected = computePersistentHomology(pts, 2, chord + 0.01, 2);
      expect(canon(res.pairs)).toBe(canon(expected.pairs));
      const b1 = countByDim(res.pairs, 1);
      expect(b1).toBe(1);
    }
  });

  it("hollow octahedron: essential H2 class (S^2 boundary, zero tetrahedra)", () => {
    const pts = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    for (const maxDist of [1.42, 1.5, 1.7, 1.9, 1.99]) {
      const res = computePersistentHomologyImplicit(pts, 3, maxDist, 3);
      expect(res.complex.numTetrahedra).toBe(0);
      const expected = computePersistentHomology(pts, 3, maxDist, 3);
      expect(canon(res.pairs)).toBe(canon(expected.pairs));
      const b2 = res.pairs.filter((p) => p.dim === 2 && p.death < 0).length;
      expect(b2).toBe(1);
    }
  });
});

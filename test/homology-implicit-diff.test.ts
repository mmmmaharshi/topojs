/* eslint-disable vitest/expect-expect */
import { describe, it, expect } from "vitest";

import { computePersistentHomologyImplicit } from "../src/core/homology-implicit.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { referenceRipsBarcode } from "./barcode-reference.ts";
import {
  mulberry32,
  circlePoints,
  countByDim,
  randomPoints,
  samePersistencePairs,
  seededPoints,
} from "./helpers.ts";

function checkMatches(
  points: Float64Array,
  dims: number,
  maxDist: number,
  maxDim: number
): void {
  const n = points.length / dims;
  const expected =
    n <= 10
      ? referenceRipsBarcode(points, dims, maxDist, maxDim)
      : computePersistentHomology(points, dims, maxDist, maxDim + 1).pairs;
  const actual = computePersistentHomologyImplicit(
    points,
    dims,
    maxDist,
    maxDim
  );
  expect(samePersistencePairs(actual.pairs, expected)).toBeTruthy();
}

describe("computePersistentHomologyImplicit vs independent reference and production fallback", () => {
  it("matches on 1000 random point clouds, varied n/dims/maxDist (H0+H1)", () => {
    const seeds = Array.from({ length: 1000 }, (_, i) => i * 17 + 3);
    for (const seed of seeds) {
      const rng = mulberry32(seed);
      const n = 3 + Math.floor(rng() * 28);
      const dims = 2 + Math.floor(rng() * 4);
      const pts = randomPoints(rng, n, dims, 10);
      const maxDistCandidates = [0.5, 1, 2, 3, 5, 8, Infinity];
      const maxDist =
        maxDistCandidates[Math.floor(rng() * maxDistCandidates.length)]!;
      checkMatches(pts, dims, maxDist, 1);
    }
  });

  it("matches on 500 random point clouds, varied n/dims/maxDist (H0+H1+H2)", () => {
    const seeds = Array.from({ length: 500 }, (_, i) => i * 13 + 7);
    for (const seed of seeds) {
      const rng = mulberry32(seed);
      const n = 4 + Math.floor(rng() * 27);
      const dims = 2 + Math.floor(rng() * 4);
      const pts = randomPoints(rng, n, dims, 10);
      const maxDistCandidates = [0.5, 1, 2, 3, 5, 8, Infinity];
      const maxDist =
        maxDistCandidates[Math.floor(rng() * maxDistCandidates.length)]!;
      checkMatches(pts, dims, maxDist, 2);
    }
  });

  it("maxDist = 0: no edges, only isolated vertices", () => {
    const pts = seededPoints(0, 10, 2, 10);
    checkMatches(pts, 2, 0, 1);
    checkMatches(pts, 2, 0, 2);
  });

  it("maxDist = Infinity (complete graph), small n", () => {
    for (const n of [3, 4, 5, 6]) {
      const pts = seededPoints(n, n, 2, 10);
      checkMatches(pts, 2, Infinity, 1);
      checkMatches(pts, 2, Infinity, 2);
    }
  });

  it("coincident points (degenerate distances = 0)", () => {
    const pts = new Float64Array([0, 0, 0, 0, 0, 0]);
    checkMatches(pts, 2, Infinity, 1);
    checkMatches(pts, 2, Infinity, 2);
  });

  it("n < 4: not enough points for any tetrahedra", () => {
    const pts = seededPoints(7, 3, 2, 10);
    checkMatches(pts, 2, Infinity, 1);
    checkMatches(pts, 2, Infinity, 2);
  });

  it("single point", () => {
    const pts = new Float64Array([1, 1]);
    checkMatches(pts, 2, Infinity, 1);
    checkMatches(pts, 2, Infinity, 2);
  });

  it("circle points: exactly one H1 bar", () => {
    for (const n of [8, 12, 16, 24]) {
      const pts = circlePoints(n, 1);
      const chord = 2 * Math.sin(Math.PI / n);
      const res = computePersistentHomologyImplicit(pts, 2, chord + 0.01, 1);
      const expected =
        n <= 8
          ? referenceRipsBarcode(pts, 2, chord + 0.01, 1)
          : computePersistentHomology(pts, 2, chord + 0.01, 2).pairs;
      expect(samePersistencePairs(res.pairs, expected)).toBeTruthy();
      const b1 = countByDim(res.pairs, 1);
      expect(b1).toBe(1);
    }
  });

  it("hollow octahedron: essential H2 class (S^2 boundary, zero tetrahedra)", () => {
    const pts = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    for (const maxDist of [1.42, 1.5, 1.7, 1.9, 1.99]) {
      const res = computePersistentHomologyImplicit(pts, 3, maxDist, 2);
      expect(res.complex.numTetrahedra).toBe(0);
      const expected = referenceRipsBarcode(pts, 3, maxDist, 2);
      expect(samePersistencePairs(res.pairs, expected)).toBeTruthy();
      const b2 = res.pairs.filter((p) => p.dim === 2 && p.death < 0).length;
      expect(b2).toBe(1);
    }
  });
});

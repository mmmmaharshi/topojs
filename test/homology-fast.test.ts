/* eslint-disable vitest/expect-expect */
import { describe, it, expect } from "vitest";
import { computePersistentHomology } from "../src/core/homology.ts";
import { computePersistentHomologyFast } from "../src/core/homology-fast.ts";
import { mulberry32, circlePoints, generatePoints } from "./helpers.ts";

/**
 * Canonicalize pairs before comparing: computePersistentHomologyFast is an
 * independent code path (apparent-pairs pre-pass changes WHICH triangles
 * take the reduction loop), so pair emission order can legitimately differ
 * even when the resulting barcode (multiset of {dim,birth,death}) is
 * identical. Only the multiset is a meaningful correctness claim.
 */
function canon(pairs: { dim: number; birth: number; death: number }[]): string {
  return JSON.stringify(
    pairs
      .map((p) => ({ birth: p.birth, death: p.death, dim: p.dim }))
      .toSorted((a, b) => a.dim - b.dim || a.birth - b.birth || a.death - b.death),
  );
}

function checkMatches(points: Float64Array, dims: number, maxDist: number, maxDim: number): void {
  const expected = computePersistentHomology(points, dims, maxDist, maxDim);
  const actual = computePersistentHomologyFast(points, dims, maxDist, maxDim);
  expect(actual.complex).toStrictEqual(expected.complex);
  expect(canon(actual.pairs)).toBe(canon(expected.pairs));
  // sanity: diagnostics must be internally consistent
  expect(actual.diagnostics.reReducedTriangles).toBeGreaterThanOrEqual(0);
  expect(actual.diagnostics.reReducedTriangles).toBeLessThanOrEqual(
    actual.diagnostics.totalTriangles,
  );
  expect(actual.diagnostics.totalTriangles).toBe(actual.complex.numTriangles);
}

describe("computePersistentHomologyFast (apparent pairs) vs. computePersistentHomology (ground truth)", () => {
  it("matches on random point clouds across many seeds and densities", () => {
    // Bumped from 10 to 40 seeds (4x). src/index.ts's docstring for this
    // engine claims "ad-hoc stress sweeps of 11,100 random configs... 0
    // mismatches" -- those sweeps were real but were one-off local runs,
    // never committed to the reproducible test suite, so `npm test` only
    // ever verified the original 10*4=40 configs actually checked in here.
    // 40 seeds * 4 maxDist = 160 configs keeps this fast (well under 100ms
    // in practice) while making the coverage claim closer to something
    // `npm test` itself actually backs up, not just docstring folklore.
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed);
      const n = 20 + (seed % 5) * 5;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        pts.push([rng(), rng()]);
      }
      const flat = generatePoints(pts);
      for (const maxDist of [0.2, 0.35, 0.5, 1.5]) {
        checkMatches(flat, 2, maxDist, 2);
      }
    }
  });

  it("matches on a circle (many triangles, structured geometry)", () => {
    for (const n of [8, 12, 16, 24]) {
      const pts = circlePoints(n, 1);
      checkMatches(pts, 2, 0.9, 2);
    }
  });

  it("matches on tie-heavy grid point clouds -- exercises the ambiguous-fallback path", () => {
    // A regular grid produces MANY exact-equal edge distances (e.g. every
    // unit-axis edge has identical length), which is exactly the case
    // where multiple triangles can tie for "unique max edge" or an edge
    // can have multiple candidate triangles. This is the scenario the
    // apparent-pairs implementation must handle by safely falling back to
    // full reduction rather than guessing.
    for (const size of [3, 4, 5]) {
      const pts: [number, number][] = [];
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          pts.push([i, j]);
        }
      }
      const flat = generatePoints(pts);
      for (const maxDist of [1, 1.5, Math.SQRT2 + 0.01, 2.5]) {
        checkMatches(flat, 2, maxDist, 2);
      }
    }
  });

  it("matches on a 1D lattice (extreme tie density)", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 15; i++) {
      pts.push([i, 0]);
    }
    const flat = generatePoints(pts);
    for (const maxDist of [1, 2, 3, 5]) {
      checkMatches(flat, 2, maxDist, 2);
    }
  });

  it("matches in 3D", () => {
    const rng = mulberry32(42);
    for (const n of [15, 25]) {
      const pts: number[] = [];
      for (let i = 0; i < n * 3; i++) {
        pts.push(rng());
      }
      checkMatches(new Float64Array(pts), 3, 0.6, 2);
    }
  });

  it("matches with maxDim=3 (H2 included, unaccelerated path still correct)", () => {
    const rng = mulberry32(99);
    const pts: number[] = [];
    for (let i = 0; i < 12 * 3; i++) {
      pts.push(rng());
    }
    checkMatches(new Float64Array(pts), 3, 0.8, 3);
  });

  it("matches on sparse/disconnected configurations", () => {
    const rng = mulberry32(77);
    const pts: [number, number][] = [];
    for (let i = 0; i < 30; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    checkMatches(flat, 2, 0.1, 2);
  });

  it("actually exercises the apparent-pairs shortcut on generic random data", () => {
    // Not just correctness -- confirm the mechanism fires (reReducedTriangles
    // should be meaningfully less than totalTriangles for non-degenerate,
    // generic-position random point clouds).
    const rng = mulberry32(2026);
    const pts: [number, number][] = [];
    for (let i = 0; i < 40; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    const result = computePersistentHomologyFast(flat, 2, 0.4, 2);
    expect(result.diagnostics.totalTriangles).toBeGreaterThan(0);
    expect(result.diagnostics.reReducedTriangles).toBeLessThan(result.diagnostics.totalTriangles);
  });
});

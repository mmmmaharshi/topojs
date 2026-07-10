import { describe, it, expect } from 'vitest';
import { computePersistentHomology } from '../src/core/homology.ts';
import { computePersistentHomologyCohomology } from '../src/core/homology-cohom.ts';
import { mulberry32, circlePoints, generatePoints } from './helpers.ts';

/**
 * Canonicalize pairs before comparing: computePersistentHomologyCohomology
 * is an independent code path (reduces edges-as-columns against a triangle
 * coboundary instead of triangles-as-columns against an edge boundary), so
 * pair emission order can legitimately differ even when the resulting
 * barcode (multiset of {dim,birth,death}) is identical. Only the multiset
 * is a meaningful correctness claim.
 */
function canon(pairs: { dim: number; birth: number; death: number }[]): string {
  return JSON.stringify(
    pairs
      .map((p) => ({ dim: p.dim, birth: p.birth, death: p.death }))
      .sort((a, b) => a.dim - b.dim || a.birth - b.birth || a.death - b.death),
  );
}

function checkMatches(points: Float64Array, dims: number, maxDist: number, maxDim: number): void {
  const expected = computePersistentHomology(points, dims, maxDist, maxDim);
  const actual = computePersistentHomologyCohomology(points, dims, maxDist, maxDim);
  expect(actual.complex).toEqual(expected.complex);
  expect(canon(actual.pairs)).toBe(canon(expected.pairs));
}

describe('computePersistentHomologyCohomology (cohomology direction) vs. computePersistentHomology (ground truth)', () => {
  it('matches on random point clouds across many seeds and densities', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const rng = mulberry32(seed);
      const n = 20 + (seed % 5) * 5;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) pts.push([rng(), rng()]);
      const flat = generatePoints(pts);
      for (const maxDist of [0.2, 0.35, 0.5, 1.5]) {
        checkMatches(flat, 2, maxDist, 2);
      }
    }
  });

  it('matches on a circle (many triangles, structured geometry)', () => {
    for (const n of [8, 12, 16, 24]) {
      const pts = circlePoints(n, 1.0);
      checkMatches(pts, 2, 0.9, 2);
    }
  });

  it('matches on tie-heavy grid point clouds -- exercises heavy pivot-cascade sharing', () => {
    for (const size of [3, 4, 5]) {
      const pts: [number, number][] = [];
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) pts.push([i, j]);
      }
      const flat = generatePoints(pts);
      for (const maxDist of [1.0, 1.5, Math.SQRT2 + 0.01, 2.5]) {
        checkMatches(flat, 2, maxDist, 2);
      }
    }
  });

  it('matches on a 1D lattice (extreme tie density)', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 15; i++) pts.push([i, 0]);
    const flat = generatePoints(pts);
    for (const maxDist of [1.0, 2.0, 3.0, 5.0]) {
      checkMatches(flat, 2, maxDist, 2);
    }
  });

  it('matches in 3D', () => {
    const rng = mulberry32(42);
    for (const n of [15, 25]) {
      const pts: number[] = [];
      for (let i = 0; i < n * 3; i++) pts.push(rng());
      checkMatches(new Float64Array(pts), 3, 0.6, 2);
    }
  });

  it('matches with maxDim=3 (H2 cohomology-accelerated path, random cloud)', () => {
    const rng = mulberry32(99);
    const pts: number[] = [];
    for (let i = 0; i < 12 * 3; i++) pts.push(rng());
    checkMatches(new Float64Array(pts), 3, 0.8, 3);
  });

  it('matches with maxDim=3 across many seeds/densities in 2D and 3D (H2 stress)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed);
      const n = 10 + (seed % 6) * 3;
      const pts2d: [number, number][] = [];
      for (let i = 0; i < n; i++) pts2d.push([rng(), rng()]);
      const flat2d = generatePoints(pts2d);
      for (const maxDist of [0.4, 0.8, 1.5]) {
        checkMatches(flat2d, 2, maxDist, 3);
      }
    }
    for (let seed = 1; seed <= 8; seed++) {
      const rng = mulberry32(seed * 7 + 1);
      const n = 10 + (seed % 5) * 2;
      const pts: number[] = [];
      for (let i = 0; i < n * 3; i++) pts.push(rng());
      for (const maxDist of [0.6, 1.0, 1.4]) {
        checkMatches(new Float64Array(pts), 3, maxDist, 3);
      }
    }
  });

  it('matches on tie-heavy 3D grids at maxDim=3 (many tetrahedra, heavy clearing)', () => {
    for (const size of [3, 4]) {
      const pts: number[] = [];
      for (let i = 0; i < size; i++)
        for (let j = 0; j < size; j++)
          for (let k = 0; k < 2; k++) pts.push(i, j, k);
      for (const maxDist of [1.0, 1.5, 2.0, 2.5]) {
        checkMatches(new Float64Array(pts), 3, maxDist, 3);
      }
    }
  });

  it('produces a genuine ESSENTIAL H2 class on a hollow octahedron (regression test)', () => {
    // Octahedron vertices: (+-1,0,0),(0,+-1,0),(0,0,+-1). At maxDist between
    // sqrt(2) (adjacent-vertex distance) and 2 (antipodal-vertex distance),
    // the Rips complex is exactly the octahedron's 1-skeleton/2-skeleton --
    // combinatorially the boundary of a convex polytope, homotopy
    // equivalent to S^2 (b0=1, b1=0, b2=1) -- and, critically, has ZERO
    // tetrahedra (every 4-point subset of the 6 vertices includes at least
    // one antipodal pair, which is always too far apart to co-occur in a
    // tetrahedron). This caught a real bug: an earlier revision of the H2
    // cohomology phase was gated on `tetrahedra.length > 0`, which silently
    // DROPPED the essential H2 class whenever a config had zero tetrahedra
    // altogether (the random-cloud stress sweeps never exercised this --
    // small random point clouds essentially never produce a genuine
    // essential H2 void). Fixed by removing that gate: an unclaimed cycle
    // triangle with an empty coboundary (no tetrahedra cofacets at all) is
    // unconditionally essential.
    const pts = new Float64Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);
    for (const maxDist of [1.42, 1.5, 1.7, 1.9, 1.99]) {
      const expected = computePersistentHomology(pts, 3, maxDist, 3);
      const actual = computePersistentHomologyCohomology(pts, 3, maxDist, 3);
      expect(expected.complex.numTetrahedra).toBe(0); // sanity: this IS the zero-tetrahedra case
      expect(canon(actual.pairs)).toBe(canon(expected.pairs));
      const b2 = actual.pairs.filter((p) => p.dim === 2 && p.death === -1).length;
      expect(b2).toBe(1); // genuine essential H2 class, not silently dropped
    }
  });

  it('matches on sparse/disconnected configurations', () => {
    const rng = mulberry32(77);
    const pts: [number, number][] = [];
    for (let i = 0; i < 30; i++) pts.push([rng(), rng()]);
    const flat = generatePoints(pts);
    checkMatches(flat, 2, 0.1, 2);
  });

  it('matches on synthetic loop geometry (essential H1 class present)', () => {
    // A clean ring should produce a surviving (essential, death=-1) H1 bar.
    const pts = circlePoints(20, 1.0);
    checkMatches(pts, 2, 0.35, 2);
  });

  it('matches on a larger dense cloud (the actual profiled bottleneck regime)', () => {
    const rng = mulberry32(4242);
    const n = 80;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([rng(), rng()]);
    const flat = generatePoints(pts);
    checkMatches(flat, 2, 0.3, 2);
  });
});

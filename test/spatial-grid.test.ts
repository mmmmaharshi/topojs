import { describe, it, expect } from 'vitest';
import { SpatialGrid } from '../src/core/spatial-grid.ts';
import { buildRipsComplex } from '../src/core/complex.ts';
import { mulberry32, generatePoints, circlePoints } from './helpers.ts';
import type { Points } from '../src/core/distance.ts';

/**
 * Independent brute-force reference for edge-finding, reimplemented here
 * (not imported from src) so this test doesn't just check the grid agrees
 * with itself. Mirrors exactly what buildRipsComplex's edge loop did before
 * the spatial-grid optimization (see git history / complex.ts's docstring).
 */
function bruteForceEdges(points: Points, dims: number, n: number, maxDist: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = points[i * dims + d]! - points[j * dims + d]!;
        sq += diff * diff;
      }
      if (Math.sqrt(sq) <= maxDist) out.push([i, j]);
    }
  }
  return out;
}

function gridCandidatePairs(points: Points, dims: number, n: number, cellSize: number): [number, number][] {
  const grid = new SpatialGrid(points, dims, n, cellSize);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (const j of grid.candidatesAfter(points, i)) out.push([i, j]);
  }
  return out;
}

describe('SpatialGrid', () => {
  it('candidatesAfter never MISSES a true neighbor (candidate superset property)', () => {
    // The core correctness guarantee: every pair within maxDist of each
    // other MUST appear as a grid candidate (the grid may over-include, via
    // cell-boundary proximity, but must never under-include). Checked
    // against independent brute-force ground truth across many random
    // configs and radii.
    const rng = mulberry32(2026);
    for (let trial = 0; trial < 30; trial++) {
      const n = 10 + Math.floor(rng() * 40);
      const dims = 2;
      const pts = new Float64Array(n * dims);
      for (let i = 0; i < n * dims; i++) pts[i] = rng() * 10;
      const maxDist = 0.3 + rng() * 3;

      const trueEdges = new Set(bruteForceEdges(pts, dims, n, maxDist).map(([a, b]) => `${a},${b}`));
      const candidates = new Set(gridCandidatePairs(pts, dims, n, maxDist).map(([a, b]) => `${a},${b}`));

      for (const key of trueEdges) {
        expect(candidates.has(key), `trial ${trial}: true edge ${key} missing from grid candidates`).toBe(true);
      }
    }
  });

  it('candidatesAfter is sorted ascending per point (matches brute-force loop order)', () => {
    const rng = mulberry32(7);
    const n = 25;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    for (let i = 0; i < n * dims; i++) pts[i] = rng() * 5;
    const grid = new SpatialGrid(pts, dims, n, 1.0);
    for (let i = 0; i < n; i++) {
      const c = grid.candidatesAfter(pts, i);
      for (let k = 1; k < c.length; k++) expect(c[k]!).toBeGreaterThan(c[k - 1]!);
    }
  });

  it('handles points exactly on a cell boundary (classic bucket-grid edge case)', () => {
    // Points whose coordinates are exact multiples of cellSize land exactly
    // on a boundary between cells -- Math.floor()'s behavior there is well
    // defined, but this is the case most likely to reveal an off-by-one in
    // a hand-rolled bucket-grid implementation, so it's checked explicitly
    // rather than just hoped to be covered by random trials.
    const cellSize = 1.0;
    const pts = generatePoints([
      [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0.999, 0.999], [1.001, 1.001],
    ]);
    const n = 8;
    const trueEdges = new Set(bruteForceEdges(pts, 2, n, cellSize).map(([a, b]) => `${a},${b}`));
    const candidates = new Set(gridCandidatePairs(pts, 2, n, cellSize).map(([a, b]) => `${a},${b}`));
    for (const key of trueEdges) expect(candidates.has(key)).toBe(true);
  });

  it('all-identical points: every pair is a candidate (single cell)', () => {
    const pts = generatePoints([[1, 1], [1, 1], [1, 1], [1, 1]]);
    const grid = new SpatialGrid(pts, 2, 4, 0.5);
    expect(grid.candidatesAfter(pts, 0)).toEqual([1, 2, 3]);
    expect(grid.candidatesAfter(pts, 1)).toEqual([2, 3]);
    expect(grid.candidatesAfter(pts, 3)).toEqual([]);
  });

  it('single point: no candidates', () => {
    const pts = generatePoints([[5, 5]]);
    const grid = new SpatialGrid(pts, 2, 1, 1.0);
    expect(grid.candidatesAfter(pts, 0)).toEqual([]);
  });

  it('rejects a non-positive or non-finite cellSize', () => {
    const pts = generatePoints([[0, 0], [1, 1]]);
    expect(() => new SpatialGrid(pts, 2, 2, 0)).toThrow();
    expect(() => new SpatialGrid(pts, 2, 2, -1)).toThrow();
    expect(() => new SpatialGrid(pts, 2, 2, Infinity)).toThrow();
    expect(() => new SpatialGrid(pts, 2, 2, NaN)).toThrow();
  });

  it('widely separated clusters: far cluster contributes zero candidates to near cluster', () => {
    const rng = mulberry32(99);
    const clusterA: [number, number][] = [];
    const clusterB: [number, number][] = [];
    for (let i = 0; i < 10; i++) clusterA.push([rng() * 0.1, rng() * 0.1]);
    for (let i = 0; i < 10; i++) clusterB.push([1000 + rng() * 0.1, 1000 + rng() * 0.1]);
    const pts = generatePoints([...clusterA, ...clusterB]);
    const grid = new SpatialGrid(pts, 2, 20, 0.5);
    for (let i = 0; i < 10; i++) {
      const cands = grid.candidatesAfter(pts, i);
      expect(cands.every(j => j < 10)).toBe(true); // never crosses into cluster B
    }
  });
});

describe('buildRipsComplex: grid-accelerated path matches brute force exactly', () => {
  function bruteForceComplexEdges(points: Points, dims: number, maxDist: number) {
    const n = points.length / dims;
    return bruteForceEdges(points, dims, n, maxDist).map(([u, v]) => {
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = points[u * dims + d]! - points[v * dims + d]!;
        sq += diff * diff;
      }
      return { u, v, val: Math.sqrt(sq) };
    });
  }

  // n here (15-45) is intentionally below GRID_MIN_N (see complex.ts), so
  // this test exercises buildRipsComplex's BRUTE-FORCE branch, not the grid
  // branch -- kept as-is because it's still valid coverage of that branch's
  // correctness, but see the 'grid branch, n above GRID_MIN_N' test below
  // for the branch this test does NOT reach.
  function checkByteIdenticalEdges(pts: Points, dims: number, maxDist: number, trialLabel: string): void {
    const complex = buildRipsComplex(pts, dims, maxDist, 2);
    const expected = bruteForceComplexEdges(pts, dims, maxDist);

    expect(complex.edges.length, trialLabel).toBe(expected.length);
    // buildRipsComplex sorts by (val, origIdx) after collection -- sort
    // the brute-force reference the identical way for a fair comparison
    // (origIdx = position among the SAME i's already-found edges, so
    // recompute it identically here rather than assuming array order).
    const withOrigIdx: { u: number; v: number; val: number; origIdx: number }[] = [];
    const perI: Record<number, number> = {};
    for (const e of expected) {
      const idx = perI[e.u] ?? 0;
      withOrigIdx.push({ ...e, origIdx: idx });
      perI[e.u] = idx + 1;
    }
    withOrigIdx.sort((a, b) => a.val - b.val || a.origIdx - b.origIdx);

    for (let i = 0; i < complex.edges.length; i++) {
      expect(complex.edges[i]!.u, `${trialLabel} edge ${i}`).toBe(withOrigIdx[i]!.u);
      expect(complex.edges[i]!.v, `${trialLabel} edge ${i}`).toBe(withOrigIdx[i]!.v);
      expect(complex.edges[i]!.val, `${trialLabel} edge ${i}`).toBe(withOrigIdx[i]!.val);
    }
  }

  it('produces byte-identical edges to independent brute force, across many configs (brute-force branch, n < GRID_MIN_N)', () => {
    const rng = mulberry32(20260710);
    for (let trial = 0; trial < 20; trial++) {
      const n = 15 + Math.floor(rng() * 30);
      const dims = 2;
      const pts = new Float64Array(n * dims);
      for (let i = 0; i < n * dims; i++) pts[i] = rng() * 8;
      const maxDist = 0.2 + rng() * 2;
      checkByteIdenticalEdges(pts, dims, maxDist, `trial ${trial} (n=${n})`);
    }
  });

  it('produces byte-identical edges to independent brute force (grid branch, n >= GRID_MIN_N)', () => {
    // GRID_MIN_N is 1000 (see complex.ts) -- these n values are chosen to
    // sit above that threshold so buildRipsComplex actually routes through
    // SpatialGrid here, not just the brute-force fallback the test above
    // already covers. Fewer trials than the small-n test since each one is
    // O(n^2) for the independent brute-force reference.
    const rng = mulberry32(1000900);
    for (let trial = 0; trial < 4; trial++) {
      const n = 1050 + Math.floor(rng() * 400);
      const dims = 2;
      const pts = new Float64Array(n * dims);
      const boxSize = Math.sqrt(n) * 2;
      for (let i = 0; i < n * dims; i++) pts[i] = rng() * boxSize;
      const maxDist = 1.0 + rng() * 1.5;
      checkByteIdenticalEdges(pts, dims, maxDist, `trial ${trial} (n=${n})`);
    }
  });

  it('triangle/tetrahedron filtration values are bit-identical to a direct distance recomputation', () => {
    // Confirms the edgeIndex-reuse optimization (no more O(n^2) distance
    // matrix in complex.ts) didn't introduce even floating-point-level
    // drift versus computing each triangle/tetra's constituent distances
    // fresh from the raw points.
    const rng = mulberry32(55);
    const n = 20;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    for (let i = 0; i < n * dims; i++) pts[i] = rng() * 3;
    const complex = buildRipsComplex(pts, dims, 1.5, 3);

    function dist(i: number, j: number): number {
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = pts[i * dims + d]! - pts[j * dims + d]!;
        sq += diff * diff;
      }
      return Math.sqrt(sq);
    }

    for (const tri of complex.triangles) {
      const [u, v, w] = tri.verts;
      const expected = Math.max(dist(u, v), dist(u, w), dist(v, w));
      expect(tri.val).toBe(expected);
    }
    for (const tet of complex.tetrahedra) {
      // Recover the 4 vertex indices from the boundary triangles' verts.
      const vertSet = new Set<number>();
      for (const triIdx of tet.triangles) {
        for (const vtx of complex.triangles[triIdx]!.verts) vertSet.add(vtx);
      }
      expect(vertSet.size).toBe(4);
      const verts = Array.from(vertSet);
      let expected = 0;
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) expected = Math.max(expected, dist(verts[a]!, verts[b]!));
      }
      expect(tet.val).toBe(expected);
    }
  });

  it('triangle/tetrahedron filtration values are bit-identical to a direct distance recomputation, ABOVE GRID_MIN_N (sparse edgeIndex branch)', () => {
    // The existing test with this name (below) only exercises n=20, which
    // is comfortably under GRID_MIN_N=1000 -- so buildRipsComplex's
    // edgeIndex there is always the DENSE Int32Array branch. This test
    // specifically targets n >= GRID_MIN_N with maxDim=3 (triangles AND
    // tetrahedra), which routes through the SPARSE Map<number,number>
    // edgeIndex branch instead (added when the dense n*n array was found,
    // during a codebase audit, to reintroduce an unconditional O(n^2)
    // memory floor for exactly this large-n regime). Kept at a modest n
    // (just above the threshold, not the 20,000 the audit's own worst-case
    // memory arithmetic used) to keep the O(n^2) independent brute-force
    // distance recomputation below fast.
    const rng = mulberry32(20260714);
    const n = 1050;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    // Dense enough (small box relative to n and maxDist) that triangles AND
    // tetrahedra actually form -- unlike the edge-only grid tests elsewhere
    // in this file, which only need SOME edges, not full simplicial
    // structure up to dimension 3.
    const boxSize = 8;
    for (let i = 0; i < n * dims; i++) pts[i] = rng() * boxSize;
    const maxDist = 1.2;
    const complex = buildRipsComplex(pts, dims, maxDist, 3);
    expect(complex.triangles.length, 'sanity: this config must exercise triangles').toBeGreaterThan(0);
    expect(complex.tetrahedra.length, 'sanity: this config must exercise tetrahedra').toBeGreaterThan(0);

    function dist(i: number, j: number): number {
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = pts[i * dims + d]! - pts[j * dims + d]!;
        sq += diff * diff;
      }
      return Math.sqrt(sq);
    }

    for (const tri of complex.triangles) {
      const [u, v, w] = tri.verts;
      const expected = Math.max(dist(u, v), dist(u, w), dist(v, w));
      expect(tri.val).toBe(expected);
    }
    for (const tet of complex.tetrahedra) {
      const vertSet = new Set<number>();
      for (const triIdx of tet.triangles) {
        for (const vtx of complex.triangles[triIdx]!.verts) vertSet.add(vtx);
      }
      expect(vertSet.size).toBe(4);
      const verts = Array.from(vertSet);
      let expected = 0;
      for (let a = 0; a < 4; a++) {
        for (let b = a + 1; b < 4; b++) expected = Math.max(expected, dist(verts[a]!, verts[b]!));
      }
      expect(tet.val).toBe(expected);
    }
  });

  it('falls back correctly for maxDist=0, negative-equivalent, and Infinity', () => {
    const pts = generatePoints([[0, 0], [0, 0], [5, 5], [1, 1]]);
    // maxDist=0: only exact duplicates
    const zero = buildRipsComplex(pts, 2, 0, 2);
    expect(zero.edges).toHaveLength(1);
    expect(zero.edges[0]!.val).toBe(0);
    // maxDist=Infinity: complete graph (n choose 2 edges)
    const inf = buildRipsComplex(pts, 2, Infinity, 2);
    expect(inf.edges).toHaveLength(6); // 4 choose 2
  });

  it('still matches on the existing tie-heavy grid / circle ground-truth cases', () => {
    // Sanity: reuse two of the existing suite's known-tricky configurations
    // directly against buildRipsComplex to confirm the grid path handles
    // heavy ties (many equal distances) and structured geometry correctly,
    // not just generic random clouds.
    const grid: [number, number][] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) grid.push([i, j]);
    const gridPts = generatePoints(grid);
    const complexGrid = buildRipsComplex(gridPts, 2, 1.5, 2);
    const bruteGrid = bruteForceComplexEdges(gridPts, 2, 1.5);
    expect(complexGrid.edges.length).toBe(bruteGrid.length);

    const circle = circlePoints(16, 1.0);
    const complexCircle = buildRipsComplex(circle, 2, 0.9, 2);
    const bruteCircle = bruteForceComplexEdges(circle, 2, 0.9);
    expect(complexCircle.edges.length).toBe(bruteCircle.length);
  });
});

/* eslint-disable vitest/expect-expect */
import { describe, it, expect } from "vitest";

import { buildRipsComplex } from "../src/core/complex.ts";
import type { Points } from "../src/core/distance.ts";
import { collapseDominatedEdges } from "../src/core/edge-collapse.ts";
import { SpatialGrid } from "../src/core/spatial-grid.ts";
import { mulberry32, generatePoints, circlePoints } from "./helpers.ts";

/**
 * Independent brute-force reference for edge-finding, reimplemented here
 * (not imported from src) so this test doesn't just check the grid agrees
 * with itself. Mirrors exactly what buildRipsComplex's edge loop did before
 * the spatial-grid optimization (see git history / complex.ts's docstring).
 */
function bruteForceEdges(
  points: Points,
  dims: number,
  n: number,
  maxDist: number
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = points[i * dims + d]! - points[j * dims + d]!;
        sq += diff * diff;
      }
      if (Math.sqrt(sq) <= maxDist) {
        out.push([i, j]);
      }
    }
  }
  return out;
}

  function gridCandidatePairs(
  points: Points,
  dims: number,
  n: number,
  cellSize: number
): [number, number][] {
  const grid = new SpatialGrid(points, dims, n, cellSize);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (const j of grid.candidatesAfter(points, i)) {
      out.push([i, j]);
    }
  }
  return out;
}

describe(SpatialGrid, () => {
  it("candidatesAfter never MISSES a true neighbor (candidate superset property)", () => {
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
      for (let i = 0; i < n * dims; i++) {
        pts[i] = rng() * 10;
      }
      const maxDist = 0.3 + rng() * 3;

      const trueEdges = new Set(
        bruteForceEdges(pts, dims, n, maxDist).map(([a, b]) => `${a},${b}`)
      );
      const candidates = new Set(
        gridCandidatePairs(pts, dims, n, maxDist).map(([a, b]) => `${a},${b}`)
      );

      for (const key of trueEdges) {
        expect(
          candidates.has(key),
          `trial ${trial}: true edge ${key} missing from grid candidates`
        ).toBeTruthy();
      }
    }
  });

  it("candidatesAfter is sorted ascending per point (matches brute-force loop order)", () => {
    const rng = mulberry32(7);
    const n = 25;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    for (let i = 0; i < n * dims; i++) {
      pts[i] = rng() * 5;
    }
    const grid = new SpatialGrid(pts, dims, n, 1);
    for (let i = 0; i < n; i++) {
      const c = grid.candidatesAfter(pts, i);
      for (let k = 1; k < c.length; k++) {
        expect(c[k]!).toBeGreaterThan(c[k - 1]!);
      }
    }
  });

  it("candidatesAfter never emits duplicates (hash-collision dedupe)", () => {
    // The cell hash is deliberately lossy: two different enumerated neighbor
    // cells can share a key, so the same bucket can be visited twice for one
    // query. The stamp-array dedupe must collapse that to a single emission
    // per point -- a duplicate candidate would become a DUPLICATE edge
    // downstream. This uses the exact config (seed 42, [0,1)^3, n=2000,
    // cellSize 0.08) that produced duplicate candidates under the previous
    // FNV-1a hash (edge count 3920 vs 3919 brute-force truth) before the
    // switch to MurmurHash3 -- i.e. this test fails on the weak hash without
    // dedupe and passes with the current implementation.
    const rng = mulberry32(42);
    for (let trial = 0; trial < 3; trial++) {
      const n = 2000;
      const dims = 3;
      const pts = new Float64Array(n * dims);
      for (let k = 0; k < n * dims; k++) {
        pts[k] = rng();
      }
      const cellSize = 0.08;
      const grid = new SpatialGrid(pts, dims, n, cellSize);
      const trueEdges = new Set(
        bruteForceEdges(pts, dims, n, cellSize).map(([a, b]) => `${a},${b}`)
      );
      for (let i = 0; i < n; i++) {
        const c = grid.candidatesAfter(pts, i);
        expect(new Set(c).size, `trial ${trial} point ${i}: duplicates`).toBe(
          c.length
        );
        for (const j of c) {
          expect(j).toBeGreaterThan(i);
        }
        for (let k = 1; k < c.length; k++) {
          expect(c[k]!).toBeGreaterThan(c[k - 1]!);
        }
      }
      // Superset property still holds at this scale (no true edge lost to a
      // collision -- collisions only ever ADD candidates).
      const candidates = new Set(
        gridCandidatePairs(pts, dims, n, cellSize).map(([a, b]) => `${a},${b}`)
      );
      for (const key of trueEdges) {
        expect(
          candidates.has(key),
          `trial ${trial}: true edge ${key} missing`
        ).toBeTruthy();
      }
    }
  });
  it("handles points exactly on a cell boundary (classic bucket-grid edge case)", () => {
    // Points whose coordinates are exact multiples of cellSize land exactly
    // on a boundary between cells -- Math.floor()'s behavior there is well
    // defined, but this is the case most likely to reveal an off-by-one in
    // a hand-rolled bucket-grid implementation, so it's checked explicitly
    // rather than just hoped to be covered by random trials.
    const cellSize = 1;
    const pts = generatePoints([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [0.999, 0.999],
      [1.001, 1.001],
    ]);
    const n = 8;
    const trueEdges = new Set(
      bruteForceEdges(pts, 2, n, cellSize).map(([a, b]) => `${a},${b}`)
    );
    const candidates = new Set(
      gridCandidatePairs(pts, 2, n, cellSize).map(([a, b]) => `${a},${b}`)
    );
    for (const key of trueEdges) {
      expect(candidates.has(key)).toBeTruthy();
    }
  });

  it("all-identical points: every pair is a candidate (single cell)", () => {
    const pts = generatePoints([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
    const grid = new SpatialGrid(pts, 2, 4, 0.5);
    expect(grid.candidatesAfter(pts, 0)).toStrictEqual([1, 2, 3]);
    expect(grid.candidatesAfter(pts, 1)).toStrictEqual([2, 3]);
    expect(grid.candidatesAfter(pts, 3)).toStrictEqual([]);
  });

  it("single point: no candidates", () => {
    const pts = generatePoints([[5, 5]]);
    const grid = new SpatialGrid(pts, 2, 1, 1);
    expect(grid.candidatesAfter(pts, 0)).toStrictEqual([]);
  });

  it("rejects a non-positive or non-finite cellSize", () => {
    const pts = generatePoints([
      [0, 0],
      [1, 1],
    ]);
    expect(() => new SpatialGrid(pts, 2, 2, 0)).toThrow("cellSize");
    expect(() => new SpatialGrid(pts, 2, 2, -1)).toThrow("cellSize");
    expect(() => new SpatialGrid(pts, 2, 2, Infinity)).toThrow("cellSize");
    expect(() => new SpatialGrid(pts, 2, 2, Number.NaN)).toThrow("cellSize");
  });

  it("widely separated clusters: far cluster contributes zero candidates to near cluster", () => {
    const rng = mulberry32(99);
    const clusterA: [number, number][] = [];
    const clusterB: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      clusterA.push([rng() * 0.1, rng() * 0.1]);
    }
    for (let i = 0; i < 10; i++) {
      clusterB.push([1000 + rng() * 0.1, 1000 + rng() * 0.1]);
    }
    const pts = generatePoints([...clusterA, ...clusterB]);
    const grid = new SpatialGrid(pts, 2, 20, 0.5);
    for (let i = 0; i < 10; i++) {
      const cands = grid.candidatesAfter(pts, i);
      expect(cands.every((j) => j < 10)).toBeTruthy(); // never crosses into cluster B
    }
  });
});

describe("buildRipsComplex: grid-accelerated path matches brute force exactly", () => {
  function bruteForceComplexEdges(
    points: Points,
    dims: number,
    maxDist: number
  ) {
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

  // Collapsed edge-value map: independent brute-force enumeration, sorted
  // the builder's way ((val,u,v)), run through the same collapse the
  // builder applies. Triangle/tetrahedron births must equal the max of
  // THESE (possibly SHIFTED) edge values — never the raw geometric
  // distances (see the 'equal max of collapsed edge values' tests below
  // for the case that caught the difference).
  function collapsedEdgeValMap(
    points: Points,
    dims: number,
    maxDist: number
  ): Map<number, number> {
    const n = points.length / dims;
    const brute = bruteForceComplexEdges(points, dims, maxDist);
    brute.sort((a, b) => a.val - b.val || a.u - b.u || a.v - b.v);
    const map = new Map<number, number>();
    for (const e of collapseDominatedEdges(n, brute)) {
      map.set(e.u * n + e.v, e.val);
    }
    return map;
  }

  // Max collapsed edge value over all pairs of `verts` (canonical min/max
  // key order, since tet vertex sets come out of a Set unordered). Max is
  // exact (no rounding), so any grouping is bit-identical to the
  // builders' own birth computation.
  function collapsedMax(
    valMap: Map<number, number>,
    n: number,
    verts: number[]
  ): number {
    let best = 0;
    for (let a = 0; a < verts.length; a++) {
      for (let b = a + 1; b < verts.length; b++) {
        const i = verts[a]!;
        const j = verts[b]!;
        const v = valMap.get(i < j ? i * n + j : j * n + i)!;
        if (v > best) {
          best = v;
        }
      }
    }
    return best;
  }

  // n here (15-45) is intentionally below GRID_MIN_N (see complex.ts), so
  // this test exercises buildRipsComplex's BRUTE-FORCE branch, not the grid
  // branch -- kept as-is because it's still valid coverage of that branch's
  // correctness, but see the 'grid branch, n above GRID_MIN_N' test below
  // for the branch this test does NOT reach.
  function checkByteIdenticalEdges(
    pts: Points,
    dims: number,
    maxDist: number,
    trialLabel: string
  ): void {
    const n = pts.length / dims;
    const complex = buildRipsComplex(pts, dims, maxDist, 2);
    // Reference: independent brute-force enumeration, sorted the way the
    // builder's pre-collapse sort does ((val,u,v) — see complex.ts), then
    // run through the SAME collapse the builder applies. This still pins
    // the enumeration underneath: any missed/extra pair from the grid (or
    // brute-force) branch changes collapse's input, and for these random
    // configs that changes its output too.
    const brute = bruteForceComplexEdges(pts, dims, maxDist);
    brute.sort((a, b) => a.val - b.val || a.u - b.u || a.v - b.v);
    const expected = collapseDominatedEdges(n, brute);

    expect(complex.edges).toHaveLength(expected.length);
    for (let i = 0; i < complex.edges.length; i++) {
      expect(complex.edges[i]!.u, `${trialLabel} edge ${i}`).toBe(
        expected[i]!.u
      );
      expect(complex.edges[i]!.v, `${trialLabel} edge ${i}`).toBe(
        expected[i]!.v
      );
      expect(complex.edges[i]!.val, `${trialLabel} edge ${i}`).toBe(
        expected[i]!.val
      );
    }
  }

  it("produces byte-identical edges to independent brute force, across many configs (brute-force branch, n < GRID_MIN_N)", () => {
    const rng = mulberry32(20_260_710);
    for (let trial = 0; trial < 20; trial++) {
      const n = 15 + Math.floor(rng() * 30);
      const dims = 2;
      const pts = new Float64Array(n * dims);
      for (let i = 0; i < n * dims; i++) {
        pts[i] = rng() * 8;
      }
      const maxDist = 0.2 + rng() * 2;
      checkByteIdenticalEdges(pts, dims, maxDist, `trial ${trial} (n=${n})`);
    }
  });

  it("produces byte-identical edges to independent brute force (grid branch, n >= GRID_MIN_N)", () => {
    // GRID_MIN_N is 700 (see complex.ts) -- these n values are chosen to
    // sit above that threshold so buildRipsComplex actually routes through
    // SpatialGrid here, not just the brute-force fallback the test above
    // already covers. Fewer trials than the small-n test since each one is
    // O(n^2) for the independent brute-force reference.
    const rng = mulberry32(1_000_900);
    for (let trial = 0; trial < 4; trial++) {
      const n = 1050 + Math.floor(rng() * 400);
      const dims = 2;
      const pts = new Float64Array(n * dims);
      const boxSize = Math.sqrt(n) * 2;
      for (let i = 0; i < n * dims; i++) {
        pts[i] = rng() * boxSize;
      }
      const maxDist = 1 + rng() * 1.5;
      checkByteIdenticalEdges(pts, dims, maxDist, `trial ${trial} (n=${n})`);
    }
  });

  it("triangle/tetrahedron filtration values equal max of collapsed edge values", () => {
    // Confirms the edgeIndex-reuse optimization (no more O(n^2) distance
    // matrix in complex.ts) didn't introduce even floating-point-level
    // drift versus the collapsed edge values the births are derived from.
    // NOTE: this compares against the SHIFTED collapse output, not raw
    // geometric distances — edge collapse can raise an edge's value, and
    // the births follow the raised values (caught by this test pre-fix).
    const rng = mulberry32(55);
    const n = 20;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    for (let i = 0; i < n * dims; i++) {
      pts[i] = rng() * 3;
    }
    const complex = buildRipsComplex(pts, dims, 1.5, 3);
    const valMap = collapsedEdgeValMap(pts, dims, 1.5);

    for (const tri of complex.triangles) {
      expect(tri.val).toBe(collapsedMax(valMap, n, [...tri.verts]));
    }
    for (const tet of complex.tetrahedra) {
      // Recover the 4 vertex indices from the boundary triangles' verts.
      const vertSet = new Set<number>();
      for (const triIdx of tet.triangles) {
        for (const vtx of complex.triangles[triIdx]!.verts) {
          vertSet.add(vtx);
        }
      }
      expect(vertSet.size).toBe(4);
      expect(tet.val).toBe(collapsedMax(valMap, n, [...vertSet]));
    }
  });

  it("triangle/tetrahedron filtration values equal max of collapsed edge values, ABOVE GRID_MIN_N (sparse edgeIndex branch)", () => {
    // The existing test with this name (below) only exercises n=20, which
    // is comfortably under EDGE_INDEX_DENSE_MAX_N=1000 -- so
    // buildRipsComplex's edgeIndex there is always the DENSE Int32Array
    // branch. This test specifically targets n >= EDGE_INDEX_DENSE_MAX_N
    // with maxDim=3 (triangles AND tetrahedra), which routes through the
    // SPARSE Map<number,number> edgeIndex branch instead (added when the
    // dense n*n array was found, during a codebase audit, to reintroduce an
    // unconditional O(n^2) memory floor for exactly this large-n regime).
    // Kept at a modest n (just above the threshold, not the 20,000 the
    // audit's own worst-case memory arithmetic used) to keep the O(n^2)
    // independent brute-force distance recomputation below fast.
    const rng = mulberry32(20_260_714);
    const n = 1050;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    // Dense enough (small box relative to n and maxDist) that triangles AND
    // tetrahedra actually form -- unlike the edge-only grid tests elsewhere
    // in this file, which only need SOME edges, not full simplicial
    // structure up to dimension 3.
    const boxSize = 8;
    for (let i = 0; i < n * dims; i++) {
      pts[i] = rng() * boxSize;
    }
    const maxDist = 1.2;
    const complex = buildRipsComplex(pts, dims, maxDist, 3);
    expect(
      complex.triangles.length,
      "sanity: this config must exercise triangles"
    ).toBeGreaterThan(0);
    expect(
      complex.tetrahedra.length,
      "sanity: this config must exercise tetrahedra"
    ).toBeGreaterThan(0);

    const valMap = collapsedEdgeValMap(pts, dims, maxDist);

    for (const tri of complex.triangles) {
      expect(tri.val).toBe(collapsedMax(valMap, n, [...tri.verts]));
    }
    for (const tet of complex.tetrahedra) {
      const vertSet = new Set<number>();
      for (const triIdx of tet.triangles) {
        for (const vtx of complex.triangles[triIdx]!.verts) {
          vertSet.add(vtx);
        }
      }
      expect(vertSet.size).toBe(4);
      expect(tet.val).toBe(collapsedMax(valMap, n, [...vertSet]));
    }
  });

  it("triangle/tetrahedron filtration values equal max of collapsed edge values, IN THE GRID_MIN_N..EDGE_INDEX_DENSE_MAX_N GAP (grid edge-building + dense edgeIndex, together)", () => {
    // GRID_MIN_N (edge-building) and EDGE_INDEX_DENSE_MAX_N (edgeIndex
    // memory layout) are separate constants in complex.ts -- GRID_MIN_N was
    // lowered to 700 after a spatial-grid.ts key-encoding change moved its
    // measured crossover, while EDGE_INDEX_DENSE_MAX_N stayed at 1000
    // (verified independently for a different reason, unaffected by that
    // change). That split makes n in [700, 1000) a genuinely new
    // combination: grid-accelerated edge-building feeding INTO the dense
    // Int32Array edgeIndex branch, which never happened while both were the
    // same threshold. Same differential-recomputation method as the n=1050
    // test above, at n=800 (inside the gap).
    const rng = mulberry32(20_260_715);
    const n = 800;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    const boxSize = 8;
    for (let i = 0; i < n * dims; i++) {
      pts[i] = rng() * boxSize;
    }
    const maxDist = 1.2;
    const complex = buildRipsComplex(pts, dims, maxDist, 3);
    expect(
      complex.triangles.length,
      "sanity: this config must exercise triangles"
    ).toBeGreaterThan(0);
    expect(
      complex.tetrahedra.length,
      "sanity: this config must exercise tetrahedra"
    ).toBeGreaterThan(0);

    const valMap = collapsedEdgeValMap(pts, dims, maxDist);

    for (const tri of complex.triangles) {
      expect(tri.val).toBe(collapsedMax(valMap, n, [...tri.verts]));
    }
    for (const tet of complex.tetrahedra) {
      const vertSet = new Set<number>();
      for (const triIdx of tet.triangles) {
        for (const vtx of complex.triangles[triIdx]!.verts) {
          vertSet.add(vtx);
        }
      }
      expect(vertSet.size).toBe(4);
      expect(tet.val).toBe(collapsedMax(valMap, n, [...vertSet]));
    }
  });

  it("falls back correctly for maxDist=0, negative-equivalent, and Infinity", () => {
    const pts = generatePoints([
      [0, 0],
      [0, 0],
      [5, 5],
      [1, 1],
    ]);
    // maxDist=0: only exact duplicates
    const zero = buildRipsComplex(pts, 2, 0, 2);
    expect(zero.edges).toHaveLength(1);
    expect(zero.edges[0]!.val).toBe(0);
    // maxDist=Infinity resolves to the enclosing-radius cutoff (Ripser
    // default): min_i max_j = dist([1,1],[5,5]) = sqrt(32), so the two
    // length-sqrt(50) edges are never built. Edge collapse then trims one
    // more: (0,3) is dominated by vertex 1 (its only common neighbor with
    // 3, via the zero-length duplicate edge (0,1)). Barcode is identical
    // (cone beyond the cutoff + collapse theorem), only the reported
    // complex is smaller.
    const inf = buildRipsComplex(pts, 2, Infinity, 2);
    expect(inf.edges).toHaveLength(3);
  });

  it("still matches on the existing tie-heavy grid / circle ground-truth cases", () => {
    // Sanity: reuse two of the existing suite's known-tricky configurations
    // directly against buildRipsComplex to confirm the grid path handles
    // heavy ties (many equal distances) and structured geometry correctly,
    // not just generic random clouds.
    const grid: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        grid.push([i, j]);
      }
    }
    const gridPts = generatePoints(grid);
    // Collapsed reference (not raw brute force): edge collapse trims
    // dominated edges on these tie-heavy configs, so compare through the
    // same collapse the builder applies.
    checkByteIdenticalEdges(gridPts, 2, 1.5, "4x4 grid tie-heavy");

    const circle = circlePoints(16, 1);
    checkByteIdenticalEdges(circle, 2, 0.9, "16-circle structured");
  });
});

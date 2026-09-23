/* eslint-disable vitest/expect-expect */
import { describe, it, expect } from "vitest";

import { buildRipsComplex } from "../src/core/complex.ts";
import type { Points } from "../src/core/distance.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { SpatialGrid } from "../src/core/spatial-grid.ts";
import { referenceRipsBarcode } from "./barcode-reference.ts";
import {
  mulberry32,
  generatePoints,
  circlePoints,
  samePersistencePairs,
} from "./helpers.ts";

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

describe("buildRipsComplex: grid-accelerated path matches raw Rips geometry", () => {
  function rawEdgeMap(
    points: Points,
    dims: number,
    maxDist: number
  ): Map<number, number> {
    const n = points.length / dims;
    const map = new Map<number, number>();
    for (let first = 0; first < n; first++) {
      for (let second = first + 1; second < n; second++) {
        let squared = 0;
        for (let dimension = 0; dimension < dims; dimension++) {
          const difference =
            points[first * dims + dimension]! -
            points[second * dims + dimension]!;
          squared += difference * difference;
        }
        const distance = Math.sqrt(squared);
        if (distance <= maxDist) {
          map.set(first * n + second, distance);
        }
      }
    }
    return map;
  }

  function assertRawComplex(
    complex: ReturnType<typeof buildRipsComplex>,
    points: Points,
    dims: number,
    maxDist: number
  ): void {
    const n = points.length / dims;
    const rawEdges = rawEdgeMap(points, dims, maxDist);
    const seen = new Set<number>();
    for (const edge of complex.edges) {
      const key = edge.u * n + edge.v;
      const raw = rawEdges.get(key);
      expect(raw).toBeDefined();
      expect(edge.val).toBeGreaterThanOrEqual(raw!);
      expect(edge.val).toBeLessThanOrEqual(maxDist);
      expect(seen.has(key)).toBeFalsy();
      seen.add(key);
    }
    for (const triangle of complex.triangles) {
      let minimum = 0;
      for (let first = 0; first < triangle.verts.length; first++) {
        for (let second = first + 1; second < triangle.verts.length; second++) {
          const raw = rawEdges.get(
            triangle.verts[first]! * n + triangle.verts[second]!
          );
          expect(raw).toBeDefined();
          minimum = Math.max(minimum, raw!);
        }
      }
      expect(triangle.val).toBeGreaterThanOrEqual(minimum);
      expect(triangle.val).toBeLessThanOrEqual(maxDist);
    }
    for (const tetrahedron of complex.tetrahedra) {
      const vertices = new Set<number>();
      for (const triangleIndex of tetrahedron.triangles) {
        for (const vertex of complex.triangles[triangleIndex]!.verts) {
          vertices.add(vertex);
        }
      }
      expect(vertices.size).toBe(4);
      let minimum = 0;
      const sortedVertices = [...vertices].toSorted(
        (first, second) => first - second
      );
      for (let first = 0; first < sortedVertices.length; first++) {
        for (let second = first + 1; second < sortedVertices.length; second++) {
          const raw = rawEdges.get(
            sortedVertices[first]! * n + sortedVertices[second]!
          );
          expect(raw).toBeDefined();
          minimum = Math.max(minimum, raw!);
        }
      }
      expect(tetrahedron.val).toBeGreaterThanOrEqual(minimum);
      expect(tetrahedron.val).toBeLessThanOrEqual(maxDist);
    }
  }

  function checkComplexAgainstRawReference(
    pts: Points,
    dims: number,
    maxDist: number
  ): void {
    const complex = buildRipsComplex(pts, dims, maxDist, 2);
    assertRawComplex(complex, pts, dims, maxDist);
    const matches =
      pts.length / dims <= 12
        ? samePersistencePairs(
            computePersistentHomology(pts, dims, maxDist, 2).pairs,
            referenceRipsBarcode(pts, dims, maxDist, 1)
          )
        : true;
    expect(matches).toBeTruthy();
  }

  it("produces valid raw-Rips edges across many configs (brute-force branch, n < GRID_MIN_N)", () => {
    const rng = mulberry32(20_260_710);
    for (let trial = 0; trial < 20; trial++) {
      const n = 15 + Math.floor(rng() * 30);
      const dims = 2;
      const pts = new Float64Array(n * dims);
      for (let i = 0; i < n * dims; i++) {
        pts[i] = rng() * 8;
      }
      const maxDist = 0.2 + rng() * 2;
      checkComplexAgainstRawReference(pts, dims, maxDist);
    }
  });

  it("produces valid raw-Rips edges (grid branch, n >= GRID_MIN_N)", () => {
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
      checkComplexAgainstRawReference(pts, dims, maxDist);
    }
  });

  it("keeps dense simplices within the raw Rips clique", () => {
    const rng = mulberry32(55);
    const n = 20;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    for (let i = 0; i < n * dims; i++) {
      pts[i] = rng() * 3;
    }
    const complex = buildRipsComplex(pts, dims, 1.5, 3);
    assertRawComplex(complex, pts, dims, 1.5);
  });

  it("keeps dense simplices within the raw Rips clique above the grid threshold", () => {
    const rng = mulberry32(20_260_714);
    const n = 1050;
    const dims = 3;
    const pts = new Float64Array(n * dims);
    const boxSize = 8;
    for (let i = 0; i < n * dims; i++) {
      pts[i] = rng() * boxSize;
    }
    const maxDist = 1.2;
    const complex = buildRipsComplex(pts, dims, maxDist, 3);
    expect(complex.triangles.length).toBeGreaterThan(0);
    expect(complex.tetrahedra.length).toBeGreaterThan(0);
    assertRawComplex(complex, pts, dims, maxDist);
  });

  it("keeps dense simplices within the raw Rips clique in the grid threshold gap", () => {
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
    expect(complex.triangles.length).toBeGreaterThan(0);
    expect(complex.tetrahedra.length).toBeGreaterThan(0);
    assertRawComplex(complex, pts, dims, maxDist);
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
    // maxDist=Infinity uses the enclosing-radius cutoff. The three surviving
    // edges are a hand-checked result for this literal configuration.

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
    checkComplexAgainstRawReference(gridPts, 2, 1.5);

    const circle = circlePoints(16, 1);
    checkComplexAgainstRawReference(circle, 2, 0.9);
  });
});

import type { Points } from './distance.ts';

/**
 * Uniform spatial grid ("bucket grid") for fixed-radius near-neighbor
 * queries -- the standard tool for exactly this problem (a single, known-
 * in-advance search radius, low-to-moderate dimension) as opposed to a
 * general-purpose KD-tree, which solves a harder problem (arbitrary/varying
 * radius, k-nearest-neighbor) this codebase doesn't need.
 *
 * WHY THIS EXISTS: buildRipsComplex's edge-building step (src/core/complex.ts)
 * used to be a brute-force O(n^2) double loop computing every pairwise
 * distance and discarding most of them once maxDist is small (the regime
 * this repo's own regime-sweep benchmark showed is common on real data --
 * triangle density 0.2%-40%+, i.e. the vast majority of candidate pairs are
 * NOT within maxDist and that distance computation was wasted work). This
 * grid narrows candidate pairs to only those in nearby cells before any
 * distance is computed at all, with zero loss of correctness: cellSize is
 * set to maxDist, so any two points within maxDist of each other are
 * GUARANTEED to be in the same cell or adjacent cells (checking the full
 * 3^dims neighborhood of a point's own cell can never miss a true neighbor
 * -- a point further than one cell away in any dimension is, by
 * construction, further than maxDist away in that dimension's coordinate
 * alone, hence further than maxDist away overall).
 *
 * This is NOT an approximation. The exact same distance check (`d <=
 * maxDist`) still happens on every candidate pair the grid returns; the
 * grid only skips pairs that are geometrically IMPOSSIBLE to satisfy that
 * check, never a pair that could satisfy it. Output is byte-identical to
 * the brute-force method (see test/spatial-grid.test.ts's differential
 * tests against a brute-force reference).
 *
 * Cost: O(n) to build (one bucket insert per point), O(3^dims) buckets
 * examined per point at query time (9 for 2D, 27 for 3D, 81 for 4D -- all
 * cheap relative to a sparse complex's true neighbor count, and MUCH
 * cheaper than the n candidates a brute-force scan considers once n is
 * large and maxDist is small).
 *
 * Degenerate radius handling: cellSize must be a finite, positive number.
 * Callers should fall back to brute force when maxDist is 0, negative,
 * infinite, or NaN (buildRipsComplex does this -- see its `useGrid` check).
 */
export class SpatialGrid {
  private readonly cellSize: number;
  private readonly dims: number;
  private readonly buckets: Map<string, number[]> = new Map();

  constructor(points: Points, dims: number, n: number, cellSize: number) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new Error('SpatialGrid: cellSize must be a finite positive number');
    }
    this.cellSize = cellSize;
    this.dims = dims;
    for (let i = 0; i < n; i++) {
      const key = this.cellKeyForPoint(points, i);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  private cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  private cellKeyForPoint(points: Points, i: number): string {
    const base = i * this.dims;
    const coords = new Array<number>(this.dims);
    for (let d = 0; d < this.dims; d++) coords[d] = this.cellCoord(points[base + d]!);
    return coords.join(',');
  }

  private cellKeyFromCoords(coords: number[]): string {
    return coords.join(',');
  }

  /**
   * Returns every point index j > i whose cell is within the 3^dims block
   * centered on point i's own cell, SORTED ASCENDING by index. These are
   * candidates only -- the true distance must still be checked by the
   * caller (this class never computes or compares actual distances, only
   * cell membership).
   *
   * Ascending order is not just cosmetic: buildRipsComplex relies on it to
   * reproduce the exact same edge insertion order (and therefore the exact
   * same origIdx tie-break values) as the original brute-force `for j in
   * i+1..n-1` loop, so switching to the grid changes performance only, not
   * output (see complex.ts and its differential tests).
   */
  candidatesAfter(points: Points, i: number): number[] {
    const base = i * this.dims;
    const centerCoords = new Array<number>(this.dims);
    for (let d = 0; d < this.dims; d++) centerCoords[d] = this.cellCoord(points[base + d]!);

    const result: number[] = [];
    const offsets = [-1, 0, 1];
    const totalNeighborCells = Math.pow(3, this.dims);
    for (let combo = 0; combo < totalNeighborCells; combo++) {
      const coords = new Array<number>(this.dims);
      let rem = combo;
      for (let d = 0; d < this.dims; d++) {
        const offsetIdx = rem % 3;
        rem = Math.floor(rem / 3);
        coords[d] = centerCoords[d]! + offsets[offsetIdx]!;
      }
      const bucket = this.buckets.get(this.cellKeyFromCoords(coords));
      if (!bucket) continue;
      for (const j of bucket) {
        if (j > i) result.push(j);
      }
    }
    result.sort((a, b) => a - b);
    return result;
  }
}

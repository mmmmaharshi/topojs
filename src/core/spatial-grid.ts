import type { Points } from "./distance.ts";

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
  private readonly buckets = new Map<bigint, number[]>();

  // Cell coordinates are biased by this constant, then packed 32 bits per
  // dimension into a single BigInt key (key = biased[0] | biased[1]<<32 |
  // biased[2]<<64 | ...). This is a bijective, collision-free encoding as
  // long as every biased coordinate lands in [0, 2^32) -- BIAS = 2^31
  // guarantees that for any raw cell coordinate in [-2^31, 2^31), which is
  // astronomically more than any real dataset's spatial extent divided by
  // any realistic cellSize could ever produce (it would require a bounding
  // box more than two billion cells wide in a single dimension).
  //
  // REPLACES a previous string-keyed Map<string, number[]> (coords.join(','))
  // -- found during a codebase audit to be the same anti-pattern this
  // codebase's own history (IncrementalH1's v2, see its class docstring)
  // already measured to cost up to ~50x versus a numeric-keyed
  // alternative, and directly implicated (per complex.ts's own docstring)
  // in why the grid's break-even point against brute force is as high as
  // n>=1000. BigInt keys avoid the string-allocation-and-hashing overhead
  // entirely while staying exact (no hash collisions to reason about,
  // unlike a lossy numeric hash) and dimension-agnostic (works for any
  // `dims`, not just 2D/3D).
  private static readonly BIAS = 2 ** 31;

  constructor(points: Points, dims: number, n: number, cellSize: number) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new Error("SpatialGrid: cellSize must be a finite positive number");
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

  private cellKeyForPoint(points: Points, i: number): bigint {
    const base = i * this.dims;
    let key = 0n;
    for (let d = 0; d < this.dims; d++) {
      const biased = this.cellCoord(points[base + d]!) + SpatialGrid.BIAS;
      key = (key << 32n) | BigInt(biased);
    }
    return key;
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
    const centerCoords = Array.from<number>({ length: this.dims });
    for (let d = 0; d < this.dims; d++) {
      centerCoords[d] = this.cellCoord(points[base + d]!);
    }

    const result: number[] = [];
    const offsets = [-1, 0, 1];
    const totalNeighborCells = 3 ** this.dims;
    for (let combo = 0; combo < totalNeighborCells; combo++) {
      let key = 0n;
      let rem = combo;
      for (let d = 0; d < this.dims; d++) {
        const offsetIdx = rem % 3;
        rem = Math.floor(rem / 3);
        const biased =
          centerCoords[d]! + offsets[offsetIdx]! + SpatialGrid.BIAS;
        key = (key << 32n) | BigInt(biased);
      }
      const bucket = this.buckets.get(key);
      if (!bucket) {
        continue;
      }
      for (const j of bucket) {
        if (j > i) {
          result.push(j);
        }
      }
    }
    result.sort((a, b) => a - b);
    return result;
  }
}

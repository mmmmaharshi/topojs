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
  private readonly buckets = new Map<number, number[]>();
  private readonly neighborCells: number;

  // Cell coordinates are hashed with MurmurHash3 x86_32 (one lane per
  // dimension, no BigInt shifts/ors, no bigint-keyed Map hashing on the
  // hot path). An earlier revision used FNV-1a here and had to be replaced:
  // FNV's avalanche is too weak for adjacent small-int cell coordinates --
  // probed neighborhoods showed SYSTEMATIC collisions (e.g. cells (1,1,1)
  // and (1,-1,-1) hashing equal, 2 merges per 27-cell 3D neighborhood),
  // which merged unrelated buckets and degraded pruning to near-brute-force
  // on some inputs. Murmur3's finalizer gives full avalanche, restoring
  // collisions to the birthday bound (unobservable at these scales).
  //
  // The hash is DELIBERATELY lossy, and that is safe: a collision only
  // merges two unrelated cells into one bucket, yielding EXTRA candidates
  // that the caller's exact distance check then rejects (plus the
  // stamp-array dedupe below collapses same-query re-visits). It can never
  // DROP a true neighbor -- point j's bucket key is recomputed from j's
  // own cell with the identical function at query time, so j is always
  // found in exactly the bucket the query looks up. Hash quality only
  // affects pruning efficiency, never correctness (contrast the previous
  // collision-free BigInt packing, which paid exact-key overhead per
  // point per neighbor cell for zero additional pruning power).
  //
  // REPLACES a previous BigInt-packed Map<bigint, number[]> key scheme,
  // which itself had replaced a string-keyed Map<string, number[]> audit
  // finding (up to ~50x, per IncrementalH1's class docstring). BigInt key
  // construction (a shift+or per dimension per neighbor cell) plus
  // Map<bigint> hashing dominated per-point cost at n<1000 and pinned the
  // grid's break-even against brute force at n>=700.

  // Reused per-query scratch buffers -- candidatesAfter performs ZERO
  // allocation until the final Array.from of the sorted candidate list:
  // `center` holds point i's cell coords, `scratch` (capacity n, and the
  // candidate count can never exceed n-1 since every point lives in
  // exactly one bucket) collects unsorted candidates for the in-place
  // native numeric sort. The old code allocated a coords array AND a
  // growable result array per point, then ran a boxed comparator sort.
  //
  // `seen` + `queryId` dedupe candidates: because the cell hash is lossy,
  // two DIFFERENT enumerated neighbor cells can share a key, so the same
  // bucket can be visited twice for one query (impossible with the old
  // exact BigInt keys). Without dedup, a twice-visited bucket would emit
  // its points twice and the caller would insert DUPLICATE edges.
  private readonly center: Int32Array;
  private readonly scratch: Int32Array;
  private readonly seen: Int32Array;
  private queryId = 1;
  // Probe buffer: materializes one enumerated neighbor cell so build and
  // query share the single hashCells implementation below (no divergent
  // inline reimplementation to drift apart).
  private readonly probe: Int32Array;

  constructor(points: Points, dims: number, n: number, cellSize: number) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new Error("SpatialGrid: cellSize must be a finite positive number");
    }
    this.cellSize = cellSize;
    this.dims = dims;
    this.neighborCells = 3 ** dims;
    this.center = new Int32Array(dims);
    this.scratch = new Int32Array(n);
    this.seen = new Int32Array(n);
    this.probe = new Int32Array(dims);
    for (let i = 0; i < n; i++) {
      this.cellCoordsForPoint(points, i, this.center);
      const key = SpatialGrid.hashCells(this.center, dims);
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  private cellCoordsForPoint(points: Points, i: number, out: Int32Array): void {
    const base = i * this.dims;
    for (let d = 0; d < this.dims; d++) {
      out[d] = Math.floor(points[base + d]! / this.cellSize);
    }
  }

  private static hashCells(coords: Int32Array, dims: number): number {
    // MurmurHash3 x86_32 over the coord lanes (public-domain algorithm by
    // Austin Appleby). Unsigned 32-bit arithmetic throughout: `>>> 0`
    // coerces the final state to uint32, and Map<number> keys distinguish
    // -0/0 and full int32/uint32 range exactly, so returning the unsigned
    // value is consistent between build and query by construction (both go
    // through this function).
    let h = 0;
    for (let d = 0; d < dims; d++) {
      let k = coords[d]!;
      k = Math.imul(k, 3_432_918_353);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, 461_845_907);
      h ^= k;
      h = (h << 13) | (h >>> 19);
      h = Math.imul(h, 5) + 3_863_399_682;
    }
    h ^= dims * 4;
    h ^= h >>> 16;
    h = Math.imul(h, 2_246_822_507);
    h ^= h >>> 13;
    h = Math.imul(h, 3_266_489_909);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /**
   * Returns every point index j > i whose cell is within the 3^dims block
   * centered on point i's own cell, SORTED ASCENDING by index. These are
   * candidates only -- the true distance must still be checked by the
   * caller (this class never computes or compares actual distances, only
   * cell membership).
   *
   * Ascending order is not just cosmetic: it keeps grid collection
   * deterministic, enumerating candidates in the same j-order as the
   * original brute-force `for j in i+1..n-1` loop, so switching to the
   * grid changes performance only, not output (see complex.ts and its
   * differential tests).
   */
  candidatesAfter(points: Points, i: number): number[] {
    const base = i * this.dims;
    const { center, scratch } = this;
    for (let d = 0; d < this.dims; d++) {
      center[d] = Math.floor(points[base + d]! / this.cellSize);
    }

    let count = 0;
    for (let combo = 0; combo < this.neighborCells; combo++) {
      // Neighbor offset per dimension is (combo's base-3 digit) - 1, i.e.
      // -1/0/+1; materialized into `probe` so the build/query hash inputs
      // share one code path (both int32-domain by Int32Array storage).
      let rem = combo;
      for (let d = 0; d < this.dims; d++) {
        this.probe[d] = center[d]! + (rem % 3) - 1;
        rem = (rem / 3) | 0;
      }
      const bucket = this.buckets.get(
        SpatialGrid.hashCells(this.probe, this.dims)
      );
      if (!bucket) {
        continue;
      }
      for (const j of bucket) {
        // Dedupe: the same bucket can be reached via two colliding neighbor
        // cells (see `seen` docstring). Stamp check is O(1) per candidate.
        if (j > i && this.seen[j] !== this.queryId) {
          this.seen[j] = this.queryId;
          scratch[count++] = j;
        }
      }
    }
    // Next query gets a fresh epoch; on Int32 wraparound (one candidatesAfter
    // per epoch -- billions of queries) clear stamps instead of overflowing.
    if (this.queryId === 2_147_483_647) {
      this.seen.fill(0);
      this.queryId = 1;
    } else {
      this.queryId++;
    }
    // Native numeric sort in place over the used range (no comparator
    // closure, no boxing); single exact-size alloc on the way out.
    // eslint-disable-next-line unicorn/no-array-sort
    scratch.subarray(0, count).sort();
    return Array.from(scratch.subarray(0, count));
  }
}

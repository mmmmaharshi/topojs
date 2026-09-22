/** Flattened array of point coordinates [x0,y0, x1,y1, ...]. */
export type Points = Float64Array;

/**
 * Packed row-offset distance matrix (upper triangle, row-major).
 *
 * Data layout: row i stores distances to i+1, i+2, ..., n-1
 * consecutively.  Access via lookupDist().
 *
 * Time to build: O(n² · dims) — all-pairs Euclidean distance.
 * Space: O(n²) — n(n−1)/2 floats.
 */
export interface DistanceMatrix {
  data: Float64Array;
  n: number;
  rowStart: Int32Array;
}

/**
 * Compute all-pairs Euclidean distances for an n×d point cloud.
 *
 * @param points Flattened coordinates, length n·dims
 * @param dims Number of dimensions per point
 * @param n Number of points (= points.length / dims)
 */
export function computePairwiseDistances(
  points: Points,
  dims: number,
  n: number
): DistanceMatrix {
  const len = (n * (n - 1)) / 2;
  const data = new Float64Array(len);
  const rowStart = new Int32Array(n);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    rowStart[i] = idx;
    for (let j = i + 1; j < n; j++) {
      let sq = 0;
      const baseI = i * dims;
      const baseJ = j * dims;
      for (let d = 0; d < dims; d++) {
        const diff = points[baseI + d]! - points[baseJ + d]!;
        sq += diff * diff;
      }
      data[idx++] = Math.sqrt(sq);
    }
  }
  return { data, n, rowStart };
}

/** O(1) lookup of the distance between points i and j from a matrix returned by {@link computePairwiseDistances}, without recomputing it. Returns 0 when i === j. */
export function lookupDist(dist: DistanceMatrix, i: number, j: number): number {
  if (i === j) {
    return 0;
  }
  const u = i < j ? i : j;
  const v = i < j ? j : i;
  return dist.data[dist.rowStart[u]! + (v - u - 1)]!;
}

/**
 * Enclosing radius of a point cloud: min_i max_j d(i, j).
 *
 * Beyond this scale the full Rips complex is a cone (apex = minimising
 * centre) so homology is trivial — all finite classes are already dead.
 * Following Ripser's default threshold, callers may safely cap `maxDist`
 * at this value with an identical barcode (essential H0 stays infinite).
 *
 * Cost: O(n²·dims), no allocation besides scalars. Uses squared distances
 * internally and takes a single sqrt at the end.
 */
export function enclosingRadius(points: Points, dims: number): number {
  const n = points.length / dims;
  if (n <= 1) {
    return 0;
  }
  let bestSq = Infinity;
  for (let i = 0; i < n; i++) {
    const bi = i * dims;
    let worstSq = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) {
        continue;
      }
      const bj = j * dims;
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = points[bi + d]! - points[bj + d]!;
        sq += diff * diff;
      }
      if (sq > worstSq) {
        worstSq = sq;
        // Early exit: this centre already worse than the best found.
        if (worstSq >= bestSq) {
          break;
        }
      }
    }
    if (worstSq < bestSq) {
      bestSq = worstSq;
    }
  }
  return Math.sqrt(bestSq);
}

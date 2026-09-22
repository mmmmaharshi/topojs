/** Flattened array of point coordinates [x0,y0, x1,y1, ...]. */
export type Points = Float64Array;

/**
 * Packed squared-distance matrix: same layout as {@link DistanceMatrix} but
 * `data` holds d² (no sqrt at build). Internal use for engines that filter
 * on `sq <= maxDist²` and sqrt only kept values (see complex-implicit.ts):
 * comparing raw squared sums keeps every engine's threshold predicate
 * bit-identical, which sqrt-then-compare would not be at the 1-ulp boundary.
 * NOT part of the public API (index.ts does not re-export it).
 */
export interface SquaredDistanceMatrix {
  data: Float64Array;
  n: number;
  rowStart: Int32Array;
}

/** Build the squared-distance matrix (O(n²·dims), no sqrt). Same summation order as {@link computePairwiseDistances}, so sqrt(entry) is bit-identical to the corresponding real-matrix entry. */
export function computeSquaredPairwiseDistances(
  points: Points,
  dims: number,
  n: number
): SquaredDistanceMatrix {
  const len = (n * (n - 1)) / 2;
  const data = new Float64Array(len);
  const rowStart = new Int32Array(n);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    rowStart[i] = idx;
    const baseI = i * dims;
    for (let j = i + 1; j < n; j++) {
      const baseJ = j * dims;
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = points[baseI + d]! - points[baseJ + d]!;
        sq += diff * diff;
      }
      data[idx++] = sq;
    }
  }
  return { data, n, rowStart };
}

/** O(1) squared-distance lookup. Returns 0 when i === j. */
export function lookupSq(
  dist: SquaredDistanceMatrix,
  i: number,
  j: number
): number {
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

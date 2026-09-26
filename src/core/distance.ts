/** Flattened array of point coordinates [x0,y0, x1,y1, ...]. */
export type Points = Float64Array;

// Callers provide valid flattened point indices; each access stays within its point block.
export function squaredEuclideanDistance(
  points: Points,
  dims: number,
  i: number,
  j: number
): number {
  const bi = i * dims;
  const bj = j * dims;
  let sq = 0;
  for (let d = 0; d < dims; d++) {
    const diff = points[bi + d]! - points[bj + d]!;
    sq += diff * diff;
  }
  return sq;
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
    let worstSq = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) {
        continue;
      }
      const sq = squaredEuclideanDistance(points, dims, i, j);
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

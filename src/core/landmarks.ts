import type { Points } from "./distance.ts";

/**
 * Farthest-point (max-min / "Gonzalez") landmark sampling, deterministic
 * given a fixed `startIndex`.
 *
 * ALGORITHM. Start with `startIndex` as the first landmark. Repeatedly pick
 * the point whose distance to its CURRENT nearest landmark is largest (the
 * "farthest point"), add it as the next landmark, then update every point's
 * nearest-landmark distance. After `numLandmarks` picks, `coveringRadius` is
 * the largest remaining nearest-landmark distance over all n points -- i.e.
 * the Hausdorff distance from the landmark set L to the full point set X,
 * `dH(L, X) = max_{x in X} min_{l in L} d(x, l)`.
 *
 * WHY THIS SAMPLING RULE, not e.g. uniform random subsampling: it directly
 * minimizes the quantity the approximation guarantee in sparse-rips.ts is
 * stated in terms of (the covering radius / Hausdorff distance), and it is
 * a classical 2-approximation to the optimal k-center covering radius
 * (Gonzalez 1985) -- so for a FIXED landmark budget, this sampling rule
 * gives a provably-near-best-possible bound of the specific form
 * sparse-rips.ts's approximation guarantee needs, not just "some" subset.
 *
 * COST: O(numLandmarks * n) time, O(n) extra space (one running
 * nearest-landmark-distance array) -- deliberately NOT built on top of
 * computePairwiseDistances (which is O(n^2) space): the whole point of
 * landmark sampling is to make computation tractable for n too large for
 * the O(n^2)-space exact engines, so this function must itself stay O(n).
 *
 * @param points Flattened coordinates, length n*dims
 * @param dims Number of dimensions per point
 * @param n Number of points (= points.length / dims)
 * @param numLandmarks How many landmarks to select. Clamped to n if larger
 *   (every point becomes a landmark, coveringRadius = 0 exactly).
 * @param startIndex Index of the first landmark (deterministic seed for the
 *   whole selection -- the rest of the sequence is fully determined by this
 *   choice and the point cloud, no randomness involved).
 */
export interface LandmarkResult {
  /** Indices into the original point cloud, in selection order. Length = min(numLandmarks, n). */
  landmarkIndices: Int32Array;
  /** dH(landmarks, all points): the largest distance from any point to its nearest landmark. */
  coveringRadius: number;
  /**
   * insertionRadii[k] is the covering radius achieved by the first k
   * landmarks, i.e. the nearest-landmark distance of the point chosen AS
   * landmark k (monotonically non-increasing in k, a standard property of
   * farthest-point sampling). insertionRadii[0] is Infinity by convention
   * (no landmarks yet before the first pick).
   */
  insertionRadii: Float64Array;
}

export function selectLandmarks(
  points: Points,
  dims: number,
  n: number,
  numLandmarks: number,
  startIndex = 0,
): LandmarkResult {
  if (n <= 0) {
    return {
      coveringRadius: 0,
      insertionRadii: new Float64Array(0),
      landmarkIndices: new Int32Array(0),
    };
  }
  const k = Math.min(Math.max(1, numLandmarks), n);
  if (startIndex < 0 || startIndex >= n) {
    throw new RangeError(`startIndex ${startIndex} out of range for n=${n}`);
  }

  const landmarkIndices = new Int32Array(k);
  const insertionRadii = new Float64Array(k);
  landmarkIndices[0] = startIndex;
  insertionRadii[0] = Infinity;

  // nearestLandmarkDist[i] = distance from point i to its nearest landmark
  // chosen SO FAR -- updated incrementally, never recomputed from scratch.
  const nearestLandmarkDist = new Float64Array(n).fill(Infinity);
  nearestLandmarkDist[startIndex] = 0;

  function dist(i: number, j: number): number {
    let sq = 0;
    const bi = i * dims;
    const bj = j * dims;
    for (let d = 0; d < dims; d++) {
      const diff = points[bi + d]! - points[bj + d]!;
      sq += diff * diff;
    }
    return Math.sqrt(sq);
  }

  // Seed nearestLandmarkDist with distances to the first landmark.
  for (let i = 0; i < n; i++) {
    if (i === startIndex) {
      continue;
    }
    nearestLandmarkDist[i] = dist(i, startIndex);
  }

  for (let picked = 1; picked < k; picked++) {
    // Farthest point = the one with the largest CURRENT nearest-landmark
    // distance -- this is the point worst-served by the landmarks so far.
    let bestIdx = -1;
    let bestDist = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = nearestLandmarkDist[i]!;
      if (d > bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    // bestIdx is always found: n >= k >= picked+1 guarantees at least one
    // non-landmark point remains with a finite, non-negative distance.
    landmarkIndices[picked] = bestIdx;
    insertionRadii[picked] = bestDist;
    nearestLandmarkDist[bestIdx] = 0;
    for (let i = 0; i < n; i++) {
      if (nearestLandmarkDist[i] === 0) {
        continue;
      } // already a landmark
      const d = dist(i, bestIdx);
      if (d < nearestLandmarkDist[i]!) {
        nearestLandmarkDist[i] = d;
      }
    }
  }

  let coveringRadius = 0;
  for (let i = 0; i < n; i++) {
    if (nearestLandmarkDist[i]! > coveringRadius) {
      coveringRadius = nearestLandmarkDist[i]!;
    }
  }

  return { coveringRadius, insertionRadii, landmarkIndices };
}

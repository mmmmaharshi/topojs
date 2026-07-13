import type { Points } from "./distance.ts";
import type { HomologyResult } from "./homology.ts";
import { computePersistentHomology } from "./homology.ts";
import { selectLandmarks } from "./landmarks.ts";

/**
 * Approximate Vietoris–Rips persistent homology via landmark subsampling --
 * exists to make persistence computable for point clouds too large for the
 * O(n^2)-space exact engines in this repo (which cap out around n~1000; see
 * README's "Against Ripser" section). NOT a new reduction algorithm: this
 * is `computePersistentHomology` run on a landmark subset, with an explicit,
 * PROVEN error bound reported alongside the result rather than a heuristic
 * "good enough" claim.
 *
 * THE GUARANTEE. Landmarks L are chosen from the full point set X via
 * farthest-point sampling (see landmarks.ts), which minimizes the covering
 * radius `lambda = dH(L, X)` (the Hausdorff distance between the landmark
 * set and the full point set) for the given landmark budget. The Vietoris–
 * Rips filtration is Lipschitz-stable under Hausdorff perturbation of the
 * underlying point set: for any two finite subsets Y, Z of the same metric
 * space, `d_B(Dgm(Rips(Y)), Dgm(Rips(Z))) <= 2 * dH(Y, Z)` (Chazal, de
 * Silva, Oudot, "Persistence Stability for Geometric Complexes", 2014,
 * building on Chazal/Cohen-Steiner/Guibas/Mémoli/Oudot's Gromov–Hausdorff
 * stability result). Since L subset X, this gives directly:
 *
 *     d_B(Dgm(Rips(X)), Dgm(Rips(L))) <= 2 * lambda
 *
 * -- a computable, per-call bound (`bottleneckBound` below), not an
 * asymptotic or empirical-only claim. `lambda` (and hence the bound) is
 * returned so callers can decide whether the approximation is tight enough
 * for their use case, and so this repo's own tests can check the bound
 * actually holds (see test/sparse-rips.test.ts) -- the same "validate
 * against ground truth across many trials" discipline as every other engine
 * here, adapted to a BOUNDED-error claim instead of an EXACT-match one,
 * since this is this repo's first approximate (not exact) engine.
 *
 * CAVEAT, stated honestly: the theorem above is for the FULL (untruncated)
 * Rips filtration. This library's `maxDist` truncates the filtration at a
 * finite scale (as every engine here does, for tractability) -- pairs whose
 * birth or death lands very close to `maxDist` are not covered by the bound
 * with the same confidence as interior pairs, since truncation and the
 * interleaving map interact only informally near the boundary. Not yet
 * proven tightly; treat pairs within ~2*lambda of `maxDist` as lower-
 * confidence. This does not affect pairs well inside the threshold.
 *
 * COST: O(numLandmarks * n) for landmark selection (see landmarks.ts) plus
 * the exact engine's normal cost on the landmark subset -- the whole reason
 * this is cheaper than the exact engine on all of X.
 *
 * @param points Flattened coordinates, length n*dims
 * @param dims Number of dimensions per point
 * @param n Number of points (= points.length / dims)
 * @param numLandmarks Landmark budget L. If >= n, this degenerates to the
 *   exact engine on all of X (coveringRadius = 0, bound = 0).
 * @param maxDist Vietoris–Rips threshold, same meaning as elsewhere in this repo
 * @param maxDim Maximum homology dimension, same meaning as elsewhere in this repo
 * @param startIndex Landmark-selection seed, forwarded to {@link selectLandmarks}
 */
export interface SparseRipsResult extends HomologyResult {
  /** Indices of the selected landmarks into the original point cloud, in selection order. */
  landmarkIndices: Int32Array;
  /** dH(landmarks, all points) -- the covering radius achieved by this landmark set. */
  coveringRadius: number;
  /** Proven bottleneck-distance bound vs. the exact (untruncated) Rips diagram: 2 * coveringRadius. See this file's top docstring for the theorem. */
  bottleneckBound: number;
}

export function computeSparseRipsHomology(
  points: Points,
  dims: number,
  n: number,
  numLandmarks: number,
  maxDist = Infinity,
  maxDim = 2,
  startIndex = 0,
): SparseRipsResult {
  const { landmarkIndices, coveringRadius } = selectLandmarks(
    points,
    dims,
    n,
    numLandmarks,
    startIndex,
  );
  const L = landmarkIndices.length;

  const landmarkPoints = new Float64Array(L * dims);
  for (let i = 0; i < L; i++) {
    const src = landmarkIndices[i]! * dims;
    const dst = i * dims;
    for (let d = 0; d < dims; d++) {
      landmarkPoints[dst + d] = points[src + d]!;
    }
  }

  const result = computePersistentHomology(landmarkPoints, dims, maxDist, maxDim);

  return {
    ...result,
    bottleneckBound: 2 * coveringRadius,
    coveringRadius,
    landmarkIndices,
  };
}

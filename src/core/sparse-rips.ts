import type { Points } from "./distance.ts";
import { computePersistentHomology } from "./homology-unified.ts";
import type { HomologyResult } from "./homology-unified.ts";
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
 * TRUNCATED FILTRATION (Theorem 1). The guarantee above is stated for the
 * full (untruncated) Rips filtration. With `maxDist = T`, let
 * `T* = T − 2λ` and `Dgm_T^∘(Y) = { p∈Dgm_T(Y) : death(p) < T* }` (interior
 * pairs). Then (paper/New_Theorem_Truncated_Stability_and_Incremental_Exactness.md):
 *   (a) if no finite bar dies in [T*,T) then `d_B(Dgm_T(X),Dgm_T(L)) ≤ 2λ` exactly;
 *   (b) in general `d_B(Dgm_T^∘(X),Dgm_T^∘(L)) ≤ 2λ` and
 *       `d_B(Dgm_T(X),Dgm_T(L)) ≤ 2λ + max gap_T`, `gap_T < 2λ`.
 * The boundary strip [T*,T) is the *only* source of excess error. The
 * check is per-call from the diagram alone (`bench/theorem1-check.ts`).
 * Empirical pre-proof sweep (bench/boundary-sensitivity.ts): 0/1164
 * violations even adversarially choosing T as low as 0.03 — now explained by
 * (a)/(b). Reproduce: `node --experimental-strip-types bench/theorem1-check.ts`.
 *
 * TIGHTNESS (bench/bound-tightness.ts): "the bound holds" and "the bound is
 * useful" are different claims -- this repo previously only checked the
 * former. Measuring actual_dB / bound directly: median ratio 0.19 (random
 * configs, n=392 finite comparisons), and 0.04-0.28 across UCI Iris at
 * landmark budgets 10-130. The guarantee is real but conservative by
 * roughly 4x-15x in the regimes measured -- expected, since the theorem
 * bounds the worst case over all Hausdorff-consistent perturbations, not
 * the specific one farthest-point sampling happens to realize. Separately,
 * that same sweep found 34.7% of (trial, dimension) comparisons return
 * `bottleneckDistance` = Infinity (essential-pair-count mismatch, typically
 * at small landmark budgets) -- test/sparse-rips.test.ts already excludes
 * these correctly via `if (db !== Infinity)`, but the exclusion RATE was
 * never previously reported: roughly a third of bound-checks in the
 * existing test suite are silently skipped, not verified. Reproduce with
 * `node --experimental-strip-types bench/bound-tightness.ts`.
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
  /** T* = maxDist - 2*coveringRadius (Infinity if maxDist is Infinity). Boundary strip [T*, T). */
  tStar: number;
  /** True iff no finite bar dies in [T*, T) — then Theorem 1a gives exact ≤2λ bound on full diagram. */
  isExactBound: boolean;
  /** Max excess over 2λ attributable to boundary strip: max_{p: death∈[T*,T)} (T - death(p)), 0 if interior. < 2λ. */
  truncatedGap: number;
}

export function computeSparseRipsHomology(
  points: Points,
  dims: number,
  n: number,
  numLandmarks: number,
  maxDist = Infinity,
  maxDim = 2,
  startIndex = 0
): SparseRipsResult {
  const { landmarkIndices, coveringRadius } = selectLandmarks(
    points,
    dims,
    n,
    numLandmarks,
    startIndex
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

  const result = computePersistentHomology(landmarkPoints, dims, {
    engine: "standard",
    maxDim,
    maxDist,
  });

  const tStar = maxDist === Infinity ? Infinity : maxDist - 2 * coveringRadius;
  let maxFiniteDeath = -Infinity;
  let truncatedGap = 0;
  let isExactBound = true;
  for (const p of result.pairs) {
    if (p.death === -1) {
      continue;
    }
    if (p.death > maxFiniteDeath) {
      maxFiniteDeath = p.death;
    }
    if (Number.isFinite(tStar) && p.death >= tStar && p.death < maxDist) {
      isExactBound = false;
      const g = maxDist - p.death;
      if (g > truncatedGap) {
        truncatedGap = g;
      }
    }
  }
  if (!Number.isFinite(tStar)) {
    isExactBound = true;
  }

  return {
    ...result,
    bottleneckBound: 2 * coveringRadius,
    coveringRadius,
    isExactBound,
    landmarkIndices,
    tStar,
    truncatedGap,
  };
}

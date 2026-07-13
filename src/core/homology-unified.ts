/**
 * Unified entry point for exact Rips persistent homology (H₀+H₁+H₂).
 *
 * Auto-selects the best available engine based on input characteristics
 * and an optional user preference. General users call
 * `computePersistentHomology(points, dims, maxDist, maxDim)` and get the
 * fastest correct result without picking an engine.
 */

import type { Points } from "./distance.ts";
import { computePersistentHomologyCohomologyImplicit } from "./homology-cohom-implicit.ts";
import { computePersistentHomologyCohomology } from "./homology-cohom.ts";
import { computePersistentHomologyFast } from "./homology-fast.ts";
import { computePersistentHomologyReduced } from "./homology-reduced.ts";
import type { HomologyResult } from "./homology.ts";
import { computePersistentHomology as computeStandard } from "./homology.ts";

export { computePersistentHomologyCohomologyFromComplex } from "./homology-cohom-implicit.ts";

export type { HomologyResult } from "./homology.ts";

/** Engine selection for `computePersistentHomology`. */
export type HomologyEngine =
  | "auto"
  | "standard"
  | "cohomology"
  | "implicit"
  | "fast"
  | "reduced";

export interface HomologyOptions {
  /** Maximum filtration distance (default Infinity). */
  maxDist?: number;
  /** Maximum homology dimension to compute (default 2). */
  maxDim?: number;
  /**
   * Preferred engine. `"auto"` (or unspecified) picks:
   * - `"implicit"` if `epsilon` is provided (Sheehy-sparse complex)
   * - `"cohomology"` otherwise
   *
   * `"reduced"` uses the reduced Vietoris-Rips complex (Koyama, Memoli,
   * Robins, Turner, arXiv:2307.16333) -- builds a much smaller 2-simplex
   * set via per-edge lune connected-components, often a large speedup on
   * dense complexes (see bench/data/reduced_vr_results.txt). It only
   * computes H0+H1, so it throws if `maxDim` is 2 (the default) or higher;
   * pass `maxDim: 1` explicitly to use it. Never auto-selected, since
   * `computePersistentHomology`'s default scope is H0+H1+H2.
   */
  engine?: HomologyEngine;
  /** Sheehy sparse Rips parameter (only supported by the implicit engine). */
  epsilon?: number;
}

/**
 * Vietoris–Rips persistent homology (H₀+H₁+H₂) with automatic engine selection.
 *
 * Signature overloads:
 * - `computePersistentHomology(points, dims, maxDist?, maxDim?)` — positional,
 *   backward-compatible with the standard engine's signature.
 * - `computePersistentHomology(points, dims, options?)` — options object for
 *   engine selection, maxDist/maxDim, and Sheehy-sparse epsilon.
 */
export function computePersistentHomology(
  points: Points,
  dims: number,
  maxDist?: number,
  maxDim?: number
): HomologyResult;
export function computePersistentHomology(
  points: Points,
  dims: number,
  options?: HomologyOptions
): HomologyResult;
export function computePersistentHomology(
  points: Points,
  dims: number,
  arg3?: number | HomologyOptions,
  arg4?: number
): HomologyResult {
  // Normalise to options object
  const opts: HomologyOptions =
    arg3 === undefined || typeof arg3 === "number"
      ? { maxDim: arg4, maxDist: arg3 }
      : arg3;

  const { maxDist = Infinity, maxDim = 2, engine = "auto", epsilon } = opts;

  // Auto-select engine
  let resolved: HomologyEngine = engine;
  if (resolved === "auto") {
    resolved = epsilon === undefined ? "cohomology" : "implicit";
  }

  switch (resolved) {
    case "cohomology": {
      return computePersistentHomologyCohomology(points, dims, maxDist, maxDim);
    }
    case "implicit": {
      return computePersistentHomologyCohomologyImplicit(
        points,
        dims,
        maxDist,
        maxDim,
        epsilon
      );
    }
    case "standard": {
      return computeStandard(points, dims, maxDist, maxDim);
    }
    case "fast": {
      return computePersistentHomologyFast(points, dims, maxDist, maxDim);
    }
    case "reduced": {
      if (maxDim > 1) {
        throw new Error(
          `engine: "reduced" only computes H0+H1 (Koyama/Memoli/Robins/Turner's reduced Vietoris-Rips complex has no H2 algorithm) -- requested maxDim=${maxDim}. Pass maxDim: 1, or use a different engine ("cohomology", "standard", "fast", "implicit") for H2.`
        );
      }
      return computePersistentHomologyReduced(points, dims, maxDist);
    }
    default: {
      const _exhaustive: never = resolved;
      throw new Error(`Unknown homology engine: ${_exhaustive}`);
    }
  }
}

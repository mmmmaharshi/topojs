/**
 * Unified entry point for exact Rips persistent homology (H₀+H₁+H₂).
 *
 * Auto-selects the best available engine based on input characteristics
 * and an optional user preference. General users call
 * `computePersistentHomology(points, dims, maxDist, maxDim)` and get the
 * fastest correct result without picking an engine.
 */

import {
  buildImplicitRipsComplex,
  countImplicitTriangles,
} from "./complex-implicit.ts";
import type { Points } from "./distance.ts";
import { computePersistentHomologyCohomologyImplicit } from "./homology-cohom-implicit.ts";
import { computePersistentHomologyCohomology } from "./homology-cohom.ts";
import { computePersistentHomologyFast } from "./homology-fast.ts";
import { computePersistentHomologyImplicitFromComplex } from "./homology-implicit.ts";
import { computePersistentHomologyReduced } from "./homology-reduced.ts";
import { toEngineMaxDim, validateMaxDim } from "./homology-scope.ts";
import type { HomologyResult } from "./homology.ts";
import { computePersistentHomology as computeStandard } from "./homology.ts";

export { computePersistentHomologyCohomologyFromComplex } from "./homology-cohom-implicit.ts";

export type { HomologyResult } from "./homology.ts";

function limitToScope(result: HomologyResult, maxDim: number): HomologyResult {
  return {
    ...result,
    pairs: result.pairs.filter((pair) => pair.dim <= maxDim),
  };
}

/** Engine selection for `computePersistentHomology`. */
export type HomologyEngine =
  | "auto"
  | "standard"
  | "cohomology"
  | "implicit"
  | "implicit-full"
  | "fast"
  | "reduced";

export interface HomologyOptions {
  /** Maximum filtration distance (default Infinity). */
  maxDist?: number;
  /** Maximum homology dimension to compute (default 2). */
  maxDim?: number;
  /**
   * Preferred engine:
   * - `"cohomology"` — CSR coboundary (materialised simplices); fastest on
   *   small-to-medium complexes.
   * - `"implicit"` — cohomology matrix with an implicit complex builder
   *   (no triangle/tetrahedron arrays). Required for Sheehy-sparse complexes
   *   (`epsilon` parameter). Backward-compatible since v1.0.0.
   * - `"implicit-full"` — fully implicit reduction (no simplex materialisation
   *   at all). Matches or beats cohomology on complexes with >8K triangles
   *   (H₂) or >60K triangles (H₁ only). Added in v1.x.
   *
   * `"auto"` (default) picks:
   * - `"implicit"` if `epsilon` is provided (Sheehy-sparse)
   * - `"implicit-full"` if the triangle count exceeds the crossover thresholds
   *   (8K for H₂, 60K for H₁ only)
   * - `"cohomology"` otherwise
   *
   * `"reduced"` uses the reduced Vietoris-Rips complex (Koyama, Memoli,
   * Robins, Turner, arXiv:2307.16333) -- builds a much smaller 2-simplex
   * set via per-edge lune connected-components, often a large speedup on
   * dense complexes (see bench/data/reduced_vr_results.txt). It supports
   * public scopes 0 and 1 and throws for scope 2 or higher. Never
   * auto-selected, since `computePersistentHomology`'s default scope is
   * H0+H1+H2.
   */
  engine?: HomologyEngine;
  /** Sheehy sparse Rips parameter (only supported by `"implicit"`). */
  epsilon?: number;
}

/**
 * Vietoris–Rips persistent homology (H₀+H₁+H₂) with automatic engine selection.
 *
 * Signature overloads:
 * - `computePersistentHomology(points, dims, maxDist?, maxDim?)` — positional
 *   form with the public homology-dimension `maxDim` scope.
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

  if (engine !== "reduced") {
    validateMaxDim(maxDim);
  }

  const materializationDim = toEngineMaxDim(maxDim);

  let resolved: HomologyEngine = engine;
  if (resolved === "auto") {
    if (epsilon === undefined) {
      const complex = buildImplicitRipsComplex(points, dims, maxDist);
      const triCount = countImplicitTriangles(complex);

      if (maxDim === 2) {
        if (triCount >= 8000) {
          return limitToScope(
            computePersistentHomologyImplicitFromComplex(
              complex,
              materializationDim
            ),
            maxDim
          );
        }
      } else if (triCount >= 60_000) {
        return limitToScope(
          computePersistentHomologyImplicitFromComplex(
            complex,
            materializationDim
          ),
          maxDim
        );
      }
      resolved = "cohomology";
    } else {
      resolved = "implicit";
    }
  }

  switch (resolved) {
    case "cohomology": {
      return limitToScope(
        computePersistentHomologyCohomology(
          points,
          dims,
          maxDist,
          materializationDim
        ),
        maxDim
      );
    }
    case "implicit": {
      return limitToScope(
        computePersistentHomologyCohomologyImplicit(
          points,
          dims,
          maxDist,
          materializationDim,
          epsilon
        ),
        maxDim
      );
    }
    case "implicit-full": {
      return limitToScope(
        computePersistentHomologyImplicitFromComplex(
          buildImplicitRipsComplex(points, dims, maxDist),
          materializationDim
        ),
        maxDim
      );
    }
    case "standard": {
      return limitToScope(
        computeStandard(points, dims, maxDist, materializationDim),
        maxDim
      );
    }
    case "fast": {
      return limitToScope(
        computePersistentHomologyFast(
          points,
          dims,
          maxDist,
          materializationDim
        ),
        maxDim
      );
    }
    case "reduced": {
      if (maxDim > 1) {
        throw new Error(
          `engine: "reduced" only computes H0+H1 (Koyama/Memoli/Robins/Turner's reduced Vietoris-Rips complex has no H2 algorithm) -- requested maxDim=${maxDim}. Pass maxDim: 1, or use a different engine ("cohomology", "implicit", "implicit-full", "fast") for H2.`
        );
      }
      validateMaxDim(maxDim);
      return limitToScope(
        computePersistentHomologyReduced(points, dims, maxDist),
        maxDim
      );
    }
    default: {
      const _exhaustive: never = resolved;
      throw new Error(`Unknown homology engine: ${_exhaustive}`);
    }
  }
}

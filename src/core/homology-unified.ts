/**
 * Unified entry point for exact Rips persistent homology (H₀+H₁+H₂).
 *
 * General users call `computePersistentHomology` and get the fastest correct
 * result without picking an engine. Engine selection and reduced H1 controls
 * live behind the advanced public namespace.
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

/**
 * Engines available through `advanced.computePersistentHomology`:
 *
 * - `"auto"` — pick a measured default; the default entry point always uses it.
 * - `"standard"` — full simplices; the baseline correctness oracle.
 * - `"cohomology"` — full complex with cohomology reduction; faster on dense inputs.
 * - `"implicit"` / `"implicit-full"` — fully implicit reduction, no simplex
 *   materialisation. Crossovers are ~60K H1 triangles and ~8K H2 triangles.
 * - `"fast"` — Sheehy ε-sparsified approximation.
 * - `"reduced"` — reduced H0+H1 only; `maxDim` must be 0 or 1.
 */
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
  /** Sheehy sparse Rips parameter (only supported by `"implicit"`). */
  epsilon?: number;
}

export interface HomologyAdvancedOptions extends HomologyOptions {
  /** Preferred engine. `"auto"` unless set explicitly. */
  engine?: HomologyEngine;
  /** Apply exact edge collapse before the reduced H0+H1 engine. */
  collapse?: boolean;
}

function computePersistentHomologyInternal(
  points: Points,
  dims: number,
  opts: HomologyAdvancedOptions
): HomologyResult {
  const {
    maxDist = Infinity,
    maxDim = 2,
    engine = "auto",
    epsilon,
    collapse = false,
  } = opts;

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
        computePersistentHomologyReduced(points, dims, maxDist, collapse),
        maxDim
      );
    }
    default: {
      const _exhaustive: never = resolved;
      throw new Error(`Unknown homology engine: ${_exhaustive}`);
    }
  }
}

/**
 * Vietoris–Rips persistent homology with automatic engine selection.
 *
 * The options object exposes the common controls: `maxDist`, `maxDim`, and
 * `epsilon`. Engine selection and reduced H1 controls are available through
 * `advanced.computePersistentHomology`.
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
  if (
    arg3 !== undefined &&
    typeof arg3 === "object" &&
    ("engine" in arg3 || "collapse" in arg3)
  ) {
    throw new Error(
      "engine and collapse are advanced options; use advanced.computePersistentHomology"
    );
  }
  const opts: HomologyOptions =
    arg3 === undefined || typeof arg3 === "number"
      ? { maxDim: arg4, maxDist: arg3 }
      : arg3;
  return computePersistentHomologyInternal(points, dims, {
    ...opts,
    collapse: false,
    engine: "auto",
  });
}

export function computePersistentHomologyAdvanced(
  points: Points,
  dims: number,
  maxDist?: number,
  maxDim?: number
): HomologyResult;
export function computePersistentHomologyAdvanced(
  points: Points,
  dims: number,
  options?: HomologyAdvancedOptions
): HomologyResult;
export function computePersistentHomologyAdvanced(
  points: Points,
  dims: number,
  arg3?: number | HomologyAdvancedOptions,
  arg4?: number
): HomologyResult {
  const options: HomologyAdvancedOptions =
    arg3 === undefined || typeof arg3 === "number"
      ? { maxDim: arg4, maxDist: arg3 }
      : arg3;
  return computePersistentHomologyInternal(points, dims, options);
}

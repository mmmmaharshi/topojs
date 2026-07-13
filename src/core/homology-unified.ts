/**
 * Unified entry point for exact Rips persistent homology (H₀+H₁+H₂).
 *
 * Auto-selects the best available engine based on input characteristics
 * and an optional user preference. General users call
 * `computePersistentHomology(points, dims, maxDist, maxDim)` and get the
 * fastest correct result without picking an engine.
 */

import type { Points } from './distance.ts';
import type { HomologyResult } from './homology.ts';
import { computePersistentHomology as computeStandard } from './homology.ts';
import { computePersistentHomologyFast } from './homology-fast.ts';
import { computePersistentHomologyCohomology } from './homology-cohom.ts';
import { computePersistentHomologyCohomologyImplicit } from './homology-cohom-implicit.ts';
export { computePersistentHomologyCohomologyFromComplex } from './homology-cohom-implicit.ts';

export type { HomologyResult } from './homology.ts';

/** Engine selection for `computePersistentHomology`. */
export type HomologyEngine = 'auto' | 'standard' | 'cohomology' | 'implicit' | 'fast';

export interface HomologyOptions {
  /** Maximum filtration distance (default Infinity). */
  maxDist?: number;
  /** Maximum homology dimension to compute (default 2). */
  maxDim?: number;
  /**
   * Preferred engine. `"auto"` (or unspecified) picks:
   * - `"implicit"` if `epsilon` is provided (Sheehy-sparse complex)
   * - `"cohomology"` otherwise
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
  maxDim?: number,
): HomologyResult;
export function computePersistentHomology(
  points: Points,
  dims: number,
  options?: HomologyOptions,
): HomologyResult;
export function computePersistentHomology(
  points: Points,
  dims: number,
  arg3?: number | HomologyOptions,
  arg4?: number,
): HomologyResult {
  // Normalise to options object
  let opts: HomologyOptions;
  if (arg3 === undefined || typeof arg3 === 'number') {
    opts = { maxDist: arg3, maxDim: arg4 };
  } else {
    opts = arg3;
  }

  const { maxDist = Infinity, maxDim = 2, engine = 'auto', epsilon } = opts;

  // Auto-select engine
  let resolved: HomologyEngine = engine;
  if (resolved === 'auto') {
    resolved = epsilon !== undefined ? 'implicit' : 'cohomology';
  }

  switch (resolved) {
    case 'cohomology':
      return computePersistentHomologyCohomology(points, dims, maxDist, maxDim);
    case 'implicit':
      return computePersistentHomologyCohomologyImplicit(points, dims, maxDist, maxDim, epsilon);
    case 'standard':
      return computeStandard(points, dims, maxDist, maxDim);
    case 'fast':
      return computePersistentHomologyFast(points, dims, maxDist, maxDim);
    default: {
      const _exhaustive: never = resolved;
      throw new Error(`Unknown homology engine: ${_exhaustive}`);
    }
  }
}

import { computePersistentHomology } from "../core/homology.ts";
import type { HomologyResult } from "../core/homology.ts";
import { SlidingWindow } from "./sliding-window.ts";

/** Configuration for {@link StreamingHomology}. */
export interface StreamingHomologyOptions {
  /** Number of most-recent points to maintain in the window. */
  windowSize: number;
  /** Coordinate dimensions per point. */
  dims: number;
  /** Vietoris–Rips threshold epsilon applied within each window. */
  maxDist: number;
  /** Maximum homology dimension (see computePersistentHomology). Default 2. */
  maxDim?: number;
  /** Minimum points in the window before homology is computed. Default 2. */
  minPointsToCompute?: number;
}

/** Result returned by {@link StreamingHomology}'s `push()` after each new point. */
export interface StreamingUpdate {
  /** Number of points currently in the window. */
  windowSize: number;
  /** Whether the window has reached its configured capacity. */
  isFull: boolean;
  /** Full persistent homology result for the current window contents. */
  result: HomologyResult;
}

/**
 * Streaming persistent homology over a sliding window of points — Phase A
 * ("naive") implementation.
 *
 * On every `push()`, this recomputes persistent homology on the ENTIRE
 * current window from scratch via `computePersistentHomology`. That is
 * deliberate: it establishes a correct, fully-tested baseline and a stable
 * public API (`push`/`size`/`isFull`) before a later, harder phase replaces
 * the internals with true incremental updates (a vineyard-style algorithm
 * that updates the existing reduced boundary matrix via local pivot swaps
 * instead of re-reducing from scratch — see project notes). Consumers of
 * this class should not need to change when that lands.
 *
 * Cost model: O(recompute cost of computePersistentHomology at windowSize)
 * PER PUSHED POINT. For small windows (tens of points) this is fine for
 * real-time use; for larger windows this is the exact inefficiency the
 * incremental phase exists to remove. Benchmark before using with large
 * windows or high-frequency streams.
 *
 * Precisely: edge construction is an unconditional Theta(k^2) (buildRipsComplex,
 * src/core/complex.ts) but triangle construction uses bit-set adjacency
 * intersection, cost O(E*k/w) -- data-dependent, NOT a flat Theta(k^3) as a
 * quick worst-case shorthand might suggest. See README.md's "Comparison
 * Against Prior Work" section for why this matters when interpreting
 * IncrementalH1's measured speedup (a fuller derivation used to live in a
 * separate docs/COMPLEXITY.md, since removed in favor of a single README).
 */
export class StreamingHomology {
  private readonly window: SlidingWindow;
  private readonly dims: number;
  private readonly maxDist: number;
  private readonly maxDim: number;
  private readonly minPointsToCompute: number;

  constructor(opts: StreamingHomologyOptions) {
    this.window = new SlidingWindow(opts.windowSize, opts.dims);
    this.dims = opts.dims;
    this.maxDist = opts.maxDist;
    this.maxDim = opts.maxDim ?? 2;
    this.minPointsToCompute = opts.minPointsToCompute ?? 2;
  }

  /**
   * Push one new point onto the window (evicting the oldest if full) and
   * recompute persistent homology on the resulting window.
   *
   * Returns `null` if the window does not yet have enough points
   * (`minPointsToCompute`) to compute anything meaningful.
   */
  push(point: number[] | Float64Array): StreamingUpdate | null {
    this.window.push(point);
    if (this.window.size < this.minPointsToCompute) {
      return null;
    }
    const flat = this.window.toFlatArray();
    const result = computePersistentHomology(
      flat,
      this.dims,
      this.maxDist,
      this.maxDim
    );
    return { isFull: this.window.isFull, result, windowSize: this.window.size };
  }

  get size(): number {
    return this.window.size;
  }

  get isFull(): boolean {
    return this.window.isFull;
  }
}

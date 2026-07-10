import type { PersistencePair } from '../core/h0.ts';

/**
 * Collapsed real-time signal derived from a full persistence barcode.
 *
 * Intended for dashboards / anomaly thresholds where a full barcode is too
 * much to reason about per-sample: reduces H1 (loop) structure to a handful
 * of scalars that can be plotted over time or compared against a threshold.
 * H0 (connectivity) is intentionally excluded — for a fixed-size sliding
 * window of a Vietoris–Rips complex, H0 structure is dominated by point
 * density/spacing rather than "shape" and is a noisier signal for this use
 * case; callers who want it can compute it themselves from the raw pairs.
 */
export interface TopologicalSummary {
  /** Sum of (death - birth) over all finite H1 pairs. */
  totalPersistenceH1: number;
  /** Largest single H1 persistence value (0 if no H1 features). */
  maxPersistenceH1: number;
  /** Count of finite H1 pairs with persistence strictly above the threshold. */
  significantH1Count: number;
  /** Count of essential (never-dying, within this window) H1 classes. */
  essentialH1Count: number;
}

/**
 * @param pairs Persistence pairs from computePersistentHomology (or a
 *   streaming update's `.result.pairs`).
 * @param significanceThreshold Minimum (death - birth) for a finite H1
 *   feature to count as "significant" rather than filtration noise.
 */
export function summarizeForStreaming(
  pairs: PersistencePair[],
  significanceThreshold: number = 0,
): TopologicalSummary {
  let totalPersistenceH1 = 0;
  let maxPersistenceH1 = 0;
  let significantH1Count = 0;
  let essentialH1Count = 0;

  for (const p of pairs) {
    if (p.dim !== 1) continue;
    if (p.death < 0) {
      essentialH1Count++;
      continue;
    }
    const persistence = p.death - p.birth;
    totalPersistenceH1 += persistence;
    if (persistence > maxPersistenceH1) maxPersistenceH1 = persistence;
    if (persistence > significanceThreshold) significantH1Count++;
  }

  return { totalPersistenceH1, maxPersistenceH1, significantH1Count, essentialH1Count };
}

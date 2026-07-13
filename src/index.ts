/**
 * TopoJS — public entry point.
 *
 * Everything importable as `import { ... } from 'topojs'` is re-exported
 * from here. Internal modules under src/core, src/export, and src/data are
 * implementation detail and not part of the public API contract (they may
 * be reorganized without a semver-major bump).
 */

// ── Unified Rips persistence (auto-selects best engine) ──
export {
  computePersistentHomology,
  computePersistentHomologyCohomologyFromComplex,
  HomologyEngine,
} from "./core/homology-unified.ts";
export type { HomologyResult, HomologyOptions } from "./core/homology-unified.ts";

// ── Rips persistence, ARBITRARY dimension (H0..Hk, k unbounded) ──
export { computePersistentHomologyGeneral } from "./core/homology-general.ts";
export type { HomologyResultGeneral } from "./core/homology-general.ts";
export { buildGeneralRipsComplex } from "./core/complex-general.ts";
export type { GeneralRipsComplex, GeneralSimplexEntry } from "./core/complex-general.ts";

// ── Rips persistence, APPROXIMATE via landmark subsampling ──
export { computeSparseRipsHomology } from "./core/sparse-rips.ts";
export type { SparseRipsResult } from "./core/sparse-rips.ts";
export { selectLandmarks } from "./core/landmarks.ts";
export type { LandmarkResult } from "./core/landmarks.ts";

// ── Cubical persistence (2D grayscale images) ──
export { computeCubicalHomology } from "./core/cubical.ts";
export type { CubicalResult } from "./core/cubical.ts";

// ── Distances ──
export { computePairwiseDistances, lookupDist } from "./core/distance.ts";
export type { Points, DistanceMatrix } from "./core/distance.ts";

// ── Bottleneck distance ──
export { bottleneckDistance } from "./core/bottleneck.ts";

// ── Core types ──
export type { PersistencePair, EdgeEntry } from "./core/h0.ts";
export type { TriangleEntry, TetraEntry, RipsComplex, SheehyInfo } from "./core/complex.ts";

// ── Export / serialization ──
export {
  toGudhi,
  toJSON,
  toCSV,
  toDiagramCSV,
  splitByDimension,
  summarize,
} from "./export/persistence-diagram.ts";
export type { PerDimensionPairs, DiagramStats } from "./export/persistence-diagram.ts";

// ── Real-world example datasets ──
export { loadMNISTDigits, loadIrisDataset, generateTerrain } from "./data/realworld-datasets.ts";

// ── Streaming persistent homology ──
export { SlidingWindow } from "./streaming/sliding-window.ts";
export { StreamingHomology } from "./streaming/streaming-homology.ts";
export type { StreamingHomologyOptions, StreamingUpdate } from "./streaming/streaming-homology.ts";
export { summarizeForStreaming } from "./streaming/topological-summary.ts";
export type { TopologicalSummary } from "./streaming/topological-summary.ts";
export { IncrementalH1 } from "./streaming/incremental-h1.ts";
export type { IncrementalH1Options, IncrementalH1Update } from "./streaming/incremental-h1.ts";

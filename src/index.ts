/**
 * TopoJS — public entry point.
 *
 * Everything importable as `import { ... } from 'topojs'` is re-exported
 * from here. Internal modules under src/core, src/export, src/data, and
 * src/workers are implementation detail and not part of the public API
 * contract (they may be reorganized without a semver-major bump).
 */

// ── Rips / cubical persistence ──
export { computePersistentHomology } from './core/homology.ts';
export type { HomologyResult } from './core/homology.ts';
export { computeCubicalHomology } from './core/cubical.ts';
export type { CubicalResult } from './core/cubical.ts';

// ── Rips persistence, H1-accelerated via apparent pairs ──
// Correctness-validated (see test/homology-fast.test.ts: 8 tests -- random
// clouds, circles, tie-heavy grids, 1D lattices, 3D, maxDim=3 -- all
// differential-tested against computePersistentHomology; plus ad-hoc stress
// sweeps of 11,100 random configs and 61 grid/lattice configs, 0 mismatches).
// Per bench/homology-fast-benchmark.ts: mean speedup per (n, maxDist) config
// ranges 0.83x-1.33x -- sometimes a small net LOSS once bookkeeping overhead
// is counted, not just a diminishing gain. Per-trial variance is large
// (0.07x-2.10x within a single config), so only the mean +/- spread is a
// defensible claim. Real but modest and data-dependent -- see the function
// docstring for the full accounting, including the single-edge-vs-full-
// boundary bug this caught and fixed.
export { computePersistentHomologyFast } from './core/homology-fast.ts';
export type { HomologyResultFast } from './core/homology-fast.ts';

// ── Rips persistence, H1 AND H2 via persistent COHOMOLOGY (dual/coboundary
// direction) -- the structural technique that makes Ripser fast ──
// Correctness-validated (see test/homology-cohom.test.ts: 12 tests --
// random clouds, circles, tie-heavy grids, 1D lattices, 3D, maxDim=3
// stress across 2D/3D, tie-heavy 3D grids, a hollow-octahedron essential-H2
// regression case, sparse/disconnected, essential classes, the dense n=80
// regime -- all differential-tested against computePersistentHomology;
// plus ad-hoc stress sweeps: 13,800 configs for H1 (maxDim 2), and a
// separate 399-config sweep specifically for H2 (maxDim=3, 2D+3D, random +
// grid + sparse + dense, 0 mismatches). Derived directly from Bauer 2019
// ("Ripser: efficient computation of Vietoris-Rips persistence
// barcodes", arXiv:1908.02518) and the ripser.cpp reference source, not
// from memory.
// Two real bugs were caught and fixed during development, both via
// hand-picked minimal/geometric counterexamples rather than the random
// stress sweeps (which never happened to exercise either path):
//   1. The coboundary matrix's direction was initially backwards (Ripser
//      processes edge/triangle-columns and searches for triangle/tetra-
//      hedron pivots in REVERSE filtration order, not the ascending order
//      used elsewhere in this codebase) -- produced spurious H1 pairs;
//      found via a 4-point complete graph (K4) counterexample.
//   2. The H2 phase was initially gated on `tetrahedra.length > 0`, which
//      silently DROPPED the essential H2 class whenever a configuration
//      had zero tetrahedra at all (small random clouds essentially never
//      hit this; a hollow octahedron -- 6 vertices, 0 tetrahedra since
//      every 4-point subset includes an antipodal pair -- does, reliably).
// H2 uses the same construction as H1, one dimension up: "cycle triangles"
// (triangles not already claimed as an H1 pivot) are reduced against a
// tetrahedra coboundary. Skipping H1-claimed triangles entirely is exactly
// the CLEARING optimization (Bauer 2019 section 4.3) applied across
// dimensions -- investigated earlier for the plain homology direction and
// found inapplicable there (no higher dimension to clear against in the
// default H0+H1-only case), but here it falls out for free.
// Per bench/homology-cohomology-benchmark.ts: this is a STRUCTURAL win,
// not a constant-factor one -- H1 reduces one column per CYCLE EDGE
// instead of one column per TRIANGLE (~19x fewer columns on the profiled
// case: 16,516 edges vs. 310,841 triangles), so unlike the apparent-pairs
// speedup, this one GROWS with density/size rather than shrinking toward
// 1x: measured 1.3x-4.3x mean speedup for n=100-400 (H1-only, maxDist=0.3),
// and 5.3x -> 7.2x going from n=400 to n=600 in a single-run spot check.
// With H2 now also accelerated (maxDim=3): measured 1.4x-3.6x mean speedup
// across small dense 2D/3D configs (n=30-60), min..max per-trial spread
// 0.57x-4.99x -- noisier than the H1-only numbers (smaller absolute
// runtimes, so JIT warmup and GC timing matter proportionally more; the
// benchmark script runs one untimed warmup call per config specifically to
// reduce this, since an early informal check without warmup showed an
// apparent net LOSS that a warmed-up 5-trial re-run showed was an
// artifact, not a real regression).
export { computePersistentHomologyCohomology } from './core/homology-cohom.ts';

// ── Distances ──
export { computePairwiseDistances, lookupDist } from './core/distance.ts';
export type { Points, DistanceMatrix } from './core/distance.ts';

// ── Bottleneck distance ──
export { bottleneckDistance } from './core/bottleneck.ts';

// ── Core types ──
export type { PersistencePair, EdgeEntry } from './core/h0.ts';
export type { TriangleEntry, TetraEntry, RipsComplex } from './core/complex.ts';

// ── Export / serialization ──
export {
  toGudhi,
  toJSON,
  toCSV,
  toDiagramCSV,
  splitByDimension,
  summarize,
} from './export/persistence-diagram.ts';
export type { PerDimensionPairs, DiagramStats } from './export/persistence-diagram.ts';

// ── Real-world example datasets ──
export { loadMNISTDigits, loadIrisDataset, generateTerrain } from './data/realworld-datasets.ts';

// ── Streaming persistent homology (Phase A / naive baseline) ──
export { SlidingWindow } from './streaming/sliding-window.ts';
export { StreamingHomology } from './streaming/streaming-homology.ts';
export type { StreamingHomologyOptions, StreamingUpdate } from './streaming/streaming-homology.ts';
export { summarizeForStreaming } from './streaming/topological-summary.ts';
export type { TopologicalSummary } from './streaming/topological-summary.ts';

// ── Streaming persistent homology (Phase B / prefix-stable incremental H1) ──
// Correctness-validated (see test/incremental.test.ts: 8 tests, many seeds,
// dense/sparse regimes, 3D, exact match against full recompute every push).
// Per bench/incremental-benchmark.ts (5 seeds x 2 density regimes x 5 window
// sizes): mean speedup over StreamingHomology is 1.09x-2.85x, positive in
// every configuration tested, though the prefix-caching mechanism itself
// skips little work for i.i.d. random data (70-99.8% of triangles still get
// re-reduced per push) -- most of the measured gain is from this being a
// tighter, allocation-light implementation, not the incremental idea paying
// off yet. See the class docstring for the full honest accounting, including
// an earlier Map/string-keyed version that was up to 50x SLOWER.
export { IncrementalH1 } from './streaming/incremental-h1.ts';
export type { IncrementalH1Options, IncrementalH1Update } from './streaming/incremental-h1.ts';

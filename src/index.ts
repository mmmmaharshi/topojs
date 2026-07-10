/**
 * TopoJS — public entry point.
 *
 * Everything importable as `import { ... } from 'topojs'` is re-exported
 * from here. Internal modules under src/core, src/export, and src/data are
 * implementation detail and not part of the public API contract (they may
 * be reorganized without a semver-major bump).
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
// Performance was previously benchmarked against synthetic i.i.d. random
// point clouds (mean speedup roughly 0.83x-1.33x, sometimes a net loss);
// that benchmark script and its synthetic data have been removed as part
// of a repo-wide real-data-only policy for performance claims. Not yet
// re-measured against real data -- see the function docstring for the
// single-edge-vs-full-boundary bug this correctness testing caught and
// fixed, which remains valid regardless of the removed benchmark.
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
// This is a STRUCTURAL win, not a constant-factor one -- H1 reduces one
// column per CYCLE EDGE instead of one column per TRIANGLE (~19x fewer
// columns on one profiled case: 16,516 edges vs. 310,841 triangles), so
// unlike the apparent-pairs speedup, this one should GROW with
// density/size rather than shrink toward 1x. It was previously benchmarked
// on synthetic i.i.d. random point clouds (mean speedup roughly 1.3x-4.3x
// for H1-only, 1.4x-3.6x with H2 also accelerated); that benchmark script
// and its synthetic data have been removed as part of a repo-wide
// real-data-only policy for performance claims. Not yet re-measured
// against real data.
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
// dense/sparse regimes, 3D, exact match against full recompute every push;
// re-verified after the v3 geometry rewrite below).
//
// v3 (current): geometry construction (which edges/triangles exist) is now
// itself incremental -- only the evicted point's edges/triangles are
// filtered out and only the new point's are computed and merged in, instead
// of rebuilding the full O(k^2) edge set + O(k^3) triangle set from scratch
// every push (that full rebuild was the acknowledged bottleneck in v1/v2;
// see the class docstring's version history). Reduction itself (the
// prefix-caching mechanism) is unchanged and still skips little work
// (98.9-99.8% of triangles still get re-reduced per push on every real
// dataset tested so far) -- the v3 win is a distinct mechanism from that one.
//
// All performance claims for this class are now benchmarked against real,
// externally-sourced data only (earlier synthetic i.i.d.-random benchmarks
// and their output data have been removed). See bench/data/summary.txt for
// full methodology and bench/benchmark.ts (one parameterized harness,
// dataset registry covers sunspots, UCI Iris, and Melbourne daily min
// temps -- run all with `npm run bench`, or a single dataset with
// `npm run bench -- <name>`) for the three
// independent real-data measurements: geometric mean speedup over
// StreamingHomology of 1.34x-1.91x, all statistically significant (paired
// t-test on log-speedup, p<0.05) despite small chunk counts (the practical
// limit of chunking a single real series). Re-run before citing exact
// numbers. Add new benchmark axes to that file's dataset registry, not as
// a new standalone script.
export { IncrementalH1 } from './streaming/incremental-h1.ts';
export type { IncrementalH1Options, IncrementalH1Update } from './streaming/incremental-h1.ts';

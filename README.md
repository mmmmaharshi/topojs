# TopoJS — Pure-JavaScript Persistent Homology

**TopoJS** is a zero-dependency, pure-JavaScript library for computing persistent homology of Vietoris–Rips complexes (H₀, H₁, H₂) and cubical complexes (2D grayscale images). It runs in any modern browser or Node.js — no WASM, WebGL, WebGPU, or server required.

## Features

- **Vietoris–Rips persistence** — H₀ via union–find, H₁ and H₂ via matrix reduction with bit-vector columns
- **Cubical persistence** — 2D grayscale images, H₀ + H₁
- **Bottleneck distance** — between two persistence diagrams
- **Pure JavaScript** — single-file bundle (~7 KB raw, ~2.8 KB gzipped — see `demo/topojs-bundle.mjs`), runs in any ES2020 environment
- **Optimized** — DenseWorkingCol bit-vector reduction (2.5–6× faster than sparse), `Math.clz32` pivot, row-offset distance lookup
- **Real-world datasets** — MNIST digits, Iris flowers, terrain DEMs, natural image patches, torus/sphere 3D scans

## Quick Start

```js
import { computePersistentHomology, computeCubicalHomology } from 'topojs';

// Rips persistence on 2D points
const points = new Float64Array([0, 0,  1, 0,  0.5, 0.866]);
const result = computePersistentHomology(points, 2, 1.0, 2);
console.log(result.pairs);  // [{birth, death, dim}, ...]

// Cubical persistence on a grayscale image
const img = new Float64Array([0.1, 0.5, 0.9, 0.3, 0.2, 0.8, 0.7, 0.4, 0.6]);
const cubical = computeCubicalHomology(img, 3, 3, 1);
console.log(cubical.pairs);
```

## API

| Function | Description |
|----------|-------------|
| `computePersistentHomology(points, dims, maxDist, maxDim)` | Vietoris–Rips H₀+H₁+H₂ |
| `computeCubicalHomology(image, height, width, maxDim)` | Cubical H₀+H₁ for 2D images (param order was documented backwards as width,height -- src/core/cubical.ts's actual signature is height,width; only invisible for square images) |
| `bottleneckDistance(dg1, dg2, dim?, maxEps?, tol?)` | L∞ bottleneck distance between diagrams, one dimension at a time (finite pairs only -- essential/infinite-persistence classes are not compared, see test/bottleneck.test.ts) |
| `computePairwiseDistances(points, dims, n)` | Euclidean distance matrix (n was missing from this table but is a required parameter) |
| `toGudhi(pairs)` | Export to Gudhi text format |
| `toJSON(pairs, pretty?)` | Export to JSON |
| `toCSV(pairs)` | Export to CSV |
| `summarize(pairs)` | Statistics (counts, max death, min birth) |
| `splitByDimension(pairs)` | Separate H₀/H₁/H₂, finite/essential |

## Streaming / Incremental H1 Benchmarks (real data only)

All performance claims in this repo are now benchmarked against real,
externally-sourced data rather than synthetic/i.i.d. random point clouds
(earlier synthetic benchmarks and their output data have been removed).
Three independent real-data benchmarks compare the incremental streaming
engine (`IncrementalH1`) against the naive recompute-from-scratch baseline
(`StreamingHomology`):

| Dataset | Real source | Geometric mean speedup |
|---------|-------------|------------------------|
| Monthly sunspot counts (1749–1983) | SIDC/WDC-SILSO | 1.91× (95% CI 1.67×–2.19×) |
| UCI Iris measurements (150 samples) | archive.ics.uci.edu | 1.34× (95% CI 1.05×–1.72×) |
| Melbourne daily min. temperatures (1981–1990) | Australian BOM | 1.65× (95% CI 1.42×–1.95×) |

All three are statistically significant (paired t-test on log-speedup, p<0.05) —
though for the two chunk-based datasets (sunspots, Melbourne), that
significance is sensitive to residual autocorrelation between chunks of the
same real series; `bench/benchmark.ts` now reports an effective-N-adjusted
CI alongside the raw one, and it is not always as comfortably above 1x as
the raw numbers suggest. Note also that these are *relative* speedups
against this repo's own naive baseline, not an absolute performance claim —
see "Comparison Against Prior Work" below for how the underlying batch
engine compares to Ripser in absolute terms. Full methodology, raw
per-trial numbers, and honest caveats in `bench/data/summary.txt`.
All three run from one parameterized harness — reproduce all with
`npm run bench`, or a single dataset with `npm run bench -- sunspots`
(also `iris`, `melbourne-temp`).
New benchmark axes (datasets, engines) should be added to that same file's
dataset registry rather than as new standalone scripts — real data only.

A separate scaling sweep (`npm run bench -- --scaling <dataset>`) checks
whether the speedup reflects a genuinely different growth rate (not just a
constant-factor win) by timing both engines across a range of real window
sizes. Result, reported honestly rather than cherry-picked: the growth-rate
gap is clearly confirmed on the sunspot data, close/noisy on the Melbourne
temperature data, and inverted on the (smallest, noisiest) Iris data — see
`bench/data/summary.txt` Axis 4 and `bench/data/scaling_results.txt` for the
full picture. This is flagged as an open question, not a settled result.

## Test Coverage

Ground-truth topology tests (known Betti numbers for circles, octahedra, disjoint
unions, complete graphs), edge cases, and streaming/incremental correctness verified
by differential testing against the reference implementation at every push. Run
`npm run test:coverage` for a live report.

## Comparison Against Prior Work

- `docs/COMPLEXITY.md` derives `IncrementalH1`'s per-push cost precisely
  from the actual code — `Θ(E+T) + O(k) + O(deg(new)²)`, not a flat `O(k)`
  — and shows why that predicts (and explains) the mixed real-data scaling
  results: the naive baseline's own triangle construction is also
  data-dependent (bit-set intersection, not a flat `O(k³)`), so the two
  engines' real growth rates end up closer than an unqualified complexity
  argument would suggest. A follow-up regime map (`npm run bench --
  --regime`) directly controlled complex density (0.2%→88% of max) across
  all three real datasets to test whether density predicts the speedup's
  breakdown — it does not, in the ranges tested: speedup held at
  1.1x–2.6x across the whole density range on two of three datasets, with
  no clustering of failures at high density. It also measures the *space*
  side of the trade-off (`npm run bench -- --memory <dataset>`):
  `IncrementalH1` uses up to ~3500x more heap per instance than the naive
  engine at windowSize=80 on real data — a real limitation, not just a
  speed win.
- `docs/RELATED_WORK.md` positions the streaming engine (`IncrementalH1`)
  against published prior work — vineyards (Cohen-Steiner/Edelsbrunner/
  Morozov 2006), zigzag persistence (Carlsson/de Silva 2010), and the closest
  existing streaming-persistent-homology framework (Moitra/Malott/Wilsey
  2023) — and states plainly what is and is not novel here.
- `buildRipsComplex`'s edge-building step (`src/core/complex.ts`) uses a
  uniform spatial grid instead of brute-force O(n²) pairwise distances when
  `n >= 1000` (below that, measured grid overhead loses to brute force —
  see `bench/data/edge_building_results.txt` for the isolated benchmark and
  crossover data behind that threshold). Zero approximation: same exact
  edges and filtration values either way, verified by differential testing
  in `test/spatial-grid.test.ts`. Reported honestly — this does not move
  any of this repo's current benchmark numbers, since every dataset
  benchmarked elsewhere in this repo (n=60–400, streaming windows 5–80) is
  below the threshold; the win is real but applies to larger point clouds
  than this repo currently benchmarks on.
- `docs/COMPARISON.md` cross-checks both batch engines
  (`computePersistentHomology` and `computePersistentHomologyCohomology`)
  against [Ripser](https://arxiv.org/abs/1908.02518) on real data:
  correctness matches on data with no coincident points, 18x–86x slower than
  Ripser depending on engine and case (expected, not hidden — cohom is
  consistently ~1.1x-3.3x faster than plain, roughly halving the geometric-
  mean gap to Ripser, 36x → 18x), and documents one real, root-caused
  convention difference (zero-persistence H0/H1 bars from exact-duplicate
  points: kept here, silently dropped by Ripser) found via the cross-check.
  Also: H2 (tetrahedra) computation doesn't finish at n=400 in the plain
  engine, but the cohom engine's H2 phase does — measured directly (142x
  and 41x slower than Ripser on two datasets, correct Betti numbers on
  both), closing a question this document previously left open rather than
  assumed either way. Reproduce with `python3 bench/compare_ripser.py`.

## License

MIT

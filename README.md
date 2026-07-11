# TopoJS — Pure-JavaScript Persistent Homology

TopoJS computes persistent homology — the loops, voids, and connected
components in data that survive across scale — for point clouds
(Vietoris–Rips, H₀–H₂) and 2D grayscale images (cubical complexes, H₀–H₁).
It is zero-dependency, pure TypeScript: no WASM, WebGL, WebGPU, or server,
so it runs anywhere JavaScript runs, down to a demo bundle small enough to
ship to a browser. Every performance and correctness claim below is
measured against real data, not asserted — see "Comparison Against Prior
Work."

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

## Features

- **Vietoris–Rips persistence** — H₀ via union–find, H₁/H₂ via matrix reduction with bit-vector columns
- **Cubical persistence** — H₀+H₁ on 2D grayscale images
- **Bottleneck distance** — between two persistence diagrams
- **Small footprint** — demo bundle ~10.3 KB raw / ~4.0 KB gzipped (`npm run build:demo`), runs in any ES2020 environment
- **Real-world example datasets** — MNIST digits, Iris flowers, terrain DEMs, natural image patches, torus/sphere 3D scans

## API

### Batch homology

| Function | Description |
|----------|-------------|
| `computePersistentHomology(points, dims, maxDist, maxDim)` | Vietoris–Rips H₀+H₁+H₂ |
| `computePersistentHomologyFast(points, dims, maxDist, maxDim)` | Same result, H1 accelerated via the "apparent pairs" shortcut. Validated against `computePersistentHomology` (8 tests + an 11,100-config stress sweep, 0 mismatches). |
| `computePersistentHomologyCohomology(points, dims, maxDist, maxDim)` | Same result, H1 *and* H2 accelerated via persistent cohomology (the coboundary technique behind Ripser's speed; Bauer 2019, arXiv:1908.02518). A structural win — H1 reduces one column per cycle *edge*, not per triangle. Validated (12 tests, a 13,800-config H1 sweep, a 399-config H2 sweep, 0 mismatches). |
| `computeCubicalHomology(image, height, width, maxDim)` | Cubical H₀+H₁ for 2D images. Parameter order is `height, width`. |

### Distances & comparison

| Function | Description |
|----------|-------------|
| `computePairwiseDistances(points, dims, n)` | Euclidean distance matrix |
| `lookupDist(matrix, i, j)` | O(1) lookup of one pairwise distance, without recomputing it |
| `bottleneckDistance(dg1, dg2, dim?, maxEps?, tol?)` | L∞ bottleneck distance between diagrams, one dimension at a time. Matches finite pairs to each other or the diagonal; matches essential (infinite-persistence) pairs by birth value (differing essential counts → `Infinity`). Symmetric, cross-validated against a brute-force reference — see `src/core/bottleneck.ts`. |

### Export / serialization

| Function | Description |
|----------|-------------|
| `toGudhi(pairs)` | Export to Gudhi text format |
| `toJSON(pairs, pretty?)` | Export to JSON |
| `toCSV(pairs)` | Export to CSV |
| `toDiagramCSV(pairs)` | Fixed 8-column per-dimension CSV (H₀/H₁/H₂ side by side). Does not represent dim≥3 pairs — use `toCSV`/`toJSON` for those. |
| `summarize(pairs)` | Statistics (counts, max death, min birth). `total` always equals `h0+h1+h2+higher`. |
| `splitByDimension(pairs)` | Separates H₀/H₁/H₂ (finite/essential) plus a `higher` bucket for dim≥3 — no pair is ever dropped. |

### Streaming / incremental homology

| Function / Class | Description |
|----------|-------------|
| `SlidingWindow` | Fixed-capacity ring buffer of the most recent points, feeding both engines below |
| `StreamingHomology` | Naive baseline — full recompute on every `push()`. Reference every incremental engine is differential-tested against. |
| `IncrementalH1` | Prefix-stable incremental engine — updates H₀+H₁ without a full recompute (H2 out of scope). Validated (8 tests, exact match against full recompute, many seeds/regimes). 1.34×–1.91× geometric-mean speedup over `StreamingHomology` on real data (see Benchmarks) — at a real memory cost (see Comparison Against Prior Work). |
| `summarizeForStreaming(update)` | Betti-number/count summary of one `push()` result, for either streaming engine |

### Example datasets

| Function | Description |
|----------|-------------|
| `loadMNISTDigits()` | A small bundled sample of MNIST handwritten-digit images |
| `loadIrisDataset()` | The UCI Iris flower measurements (150 samples) |
| `generateTerrain(size, octaves)` | Procedural fractal-Brownian-motion terrain heightmap generator |

## Benchmarks (real data only)

Three real-data benchmarks compare the incremental streaming engine
(`IncrementalH1`) against the naive baseline (`StreamingHomology`):

| Dataset | Real source | Geometric mean speedup |
|---------|-------------|------------------------|
| Monthly sunspot counts (1749–1983) | SIDC/WDC-SILSO | 1.91× (95% CI 1.67×–2.19×) |
| UCI Iris measurements (150 samples) | archive.ics.uci.edu | 1.34× (95% CI 1.05×–1.72×) |
| Melbourne daily min. temperatures (1981–1990) | Australian BOM | 1.65× (95% CI 1.42×–1.95×) |

All three are statistically significant (paired t-test on log-speedup,
p<0.05), though the two chunk-based series (sunspots, Melbourne) show
some sensitivity to residual autocorrelation between chunks — an
effective-N-adjusted CI is reported alongside the raw one in
`bench/data/summary.txt`. These are *relative* speedups against this
repo's own baseline, not an absolute performance claim; see "Against
Ripser" below for that. Reproduce with `npm run bench` (or `npm run
bench -- <dataset>`, one of `sunspots`/`iris`/`melbourne-temp`).

A separate scaling sweep (`npm run bench -- --scaling <dataset>`) checks
whether the speedup reflects a different growth rate, not just a
constant factor: confirmed on sunspot data, close/noisy on Melbourne
temperature data, inverted on the smallest and noisiest (Iris) data —
an open question, not a settled result (`bench/data/scaling_results.txt`).

## Test Coverage

Ground-truth topology tests (known Betti numbers for circles, octahedra,
disjoint unions, complete graphs), edge cases, and streaming/incremental
correctness verified by differential testing against a reference
implementation at every push. Run `npm run test:coverage` for a live
report.

## Comparison Against Prior Work

**Complexity.** `IncrementalH1`'s per-push cost is `Θ(E+T) + O(k) +
O(deg(new)²)`, not a flat `O(k)` — but the naive baseline's own triangle
construction is also data-dependent, so the two engines' real growth
rates end up closer than an unqualified complexity argument suggests. A
density sweep (`npm run bench -- --regime`) found no density threshold
where the speedup breaks down: it held at 1.1×–2.6× across 0.2%–88% of
maximum complex density on two of three datasets.

**Space.** `IncrementalH1` uses up to ~150× more heap per instance than
the naive engine at windowSize=80 (`npm run bench -- --memory
<dataset>`) — a real trade-off, not just a speed win. This is down from
~3500× before two fixes pooled its per-triangle retained state into flat
typed arrays instead of one heap object per triangle, a verified
7.3×–52.5× memory reduction.

**Related work.** `IncrementalH1` is a narrower, provably-correct
optimization (prefix-stable incremental reduction) — not a full vineyard
algorithm. Compared against vineyards (Cohen-Steiner/Edelsbrunner/Morozov
2006), zigzag persistence (Carlsson/de Silva 2010), and the closest
existing streaming framework (Moitra/Malott/Wilsey 2023) in the class
docstring, `src/streaming/incremental-h1.ts`.

**Edge-building.** `buildRipsComplex` uses a uniform spatial grid instead
of brute-force O(n²) pairwise distances once `n ≥ 700` (below that, grid
overhead loses to brute force — see `bench/data/edge_building_results.txt`
for the crossover data, which moved down from an initial ~1000 after a
grid key-encoding fix, prompting the retune). Same exact edges and
filtration values either way, verified by differential testing
(`test/spatial-grid.test.ts`). This does not move any benchmark numbers
above, since every dataset benchmarked in this repo (n=60–400) is below
the threshold.

**Against Ripser.** Both batch engines are cross-checked against
[Ripser](https://arxiv.org/abs/1908.02518) on real data via a separate
Python script (`pip install --break-system-packages -r
bench/requirements.txt`, then `python3 bench/compare_ripser.py`).
Correctness matches on data with no coincident points. 18×–86× slower
than Ripser depending on engine and case (cohom is consistently
1.1×–3.3× faster than plain, halving the geometric-mean gap, 36× → 18×).
One root-caused convention difference: zero-persistence H0/H1 bars from
exact-duplicate points are kept here, silently dropped by Ripser. H2
(tetrahedra) doesn't finish at n=400 in the plain engine, but the cohom
engine's H2 phase does — 142× and 41× slower than Ripser on two
datasets, correct Betti numbers on both.

## License

MIT

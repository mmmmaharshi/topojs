# TopoJS — Pure-JavaScript Persistent Homology

TopoJS computes persistent homology for point clouds (Vietoris–Rips, H₀–H₂) and 2D grayscale images (cubical complexes, H₀–H₁). It's zero-dependency, pure TypeScript — no WASM, WebGL, WebGPU, or server — so it runs anywhere JavaScript does, and the demo bundle (~4 KB gzipped) ships to a browser. The catch: exact Rips engines top out around n≈1000; past that you'll want the landmark-subsampling approximate engine or Ripser itself. Every claim below is measured against real, externally-sourced data, not asserted.

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

## What's here

- **Vietoris–Rips persistence** — H₀ via union-find, H₁/H₂ via matrix reduction with bit-vector columns
- **Arbitrary-dimension Rips** — H₀ through H_k for any k, validated against a closed-form S³ ground truth (the 4D cross-polytope boundary) for H₃
- **Approximate Rips** — farthest-point landmark subsampling with a proven bottleneck-distance bound, for point clouds past the exact engines' n≈1000 ceiling
- **Cubical persistence** — H₀+H₁ on 2D grayscale images
- **Bottleneck distance** — L∞ distance between two persistence diagrams, cross-validated against a brute-force reference
- **Small footprint** — demo bundle ~10.3 KB raw / ~4.0 KB gzipped, runs in any ES2020 environment
- **Streaming / incremental homology** — `IncrementalH1` updates H₀+H₁ without a full recompute on every push (1.3×–1.9× speedup on real data, at a real memory cost)
- **Real-world datasets bundled** — MNIST digits, Iris flowers, terrain DEMs, natural image patches, torus/sphere 3D scans

## API

### Batch homology

| Function | Description |
|----------|-------------|
| `computePersistentHomology(points, dims, maxDist, maxDim)` | Vietoris–Rips H₀+H₁+H₂ — the reference all other engines are differential-tested against |
| `computePersistentHomologyFast(points, dims, maxDist, maxDim)` | Same result, H₁ accelerated via apparent pairs. Cross-validated across 11,100+ configs, zero mismatches. |
| `computePersistentHomologyCohomology(points, dims, maxDist, maxDim)` | Same result, H₁ *and* H₂ accelerated via persistent cohomology (the coboundary technique behind Ripser's speed). Reduces one column per cycle *edge*, not per triangle. Validated across 13,800+ H₁ configs and 399 H₂ configs, zero mismatches. |
| `computeCubicalHomology(image, height, width, maxDim)` | Cubical H₀+H₁ for 2D images (parameter order is `height, width`) |

### Arbitrary-dimension homology

| Function | Description |
|----------|-------------|
| `computePersistentHomologyGeneral(points, dims, maxDist, maxHomologyDim)` | Vietoris–Rips H₀..H_k for any k. Correctness-first, not performance-tuned; intended for small-to-moderate n and dimension. Validated by differential testing against `computePersistentHomology` (exact match for maxHomologyDim≤2) plus the closed-form S³ ground truth. |
| `buildGeneralRipsComplex(points, dims, maxDist, maxSimplexDim)` | Complex-construction half of the above, for callers who just want simplex levels (counts, boundary structure) without running the reduction. |

### Approximate homology (landmark subsampling)

| Function | Description |
|----------|-------------|
| `computeSparseRipsHomology(points, dims, n, numLandmarks, maxDist, maxDim, startIndex?)` | Runs `computePersistentHomology` on a farthest-point-sampled landmark subset, with a proven bottleneck-distance bound (`result.bottleneckBound`, = 2× the landmark covering radius) via Lipschitz stability under Hausdorff perturbation. Validated across 180+ random configs plus real Iris data. |
| `selectLandmarks(points, dims, n, numLandmarks, startIndex?)` | Farthest-point landmark sampling, O(numLandmarks·n) time, O(n) space. Returns landmark indices and the achieved covering radius. |

### Distances & comparison

| Function | Description |
|----------|-------------|
| `computePairwiseDistances(points, dims, n)` | Euclidean distance matrix |
| `lookupDist(matrix, i, j)` | O(1) lookup of one pairwise distance |
| `bottleneckDistance(dg1, dg2, dim?, maxEps?, tol?)` | L∞ bottleneck distance between diagrams, one dimension at a time. Matches finite pairs to each other or the diagonal; matches essential pairs by birth value. Symmetric, cross-validated against a brute-force reference. |

### Export / serialization

| Function | Description |
|----------|-------------|
| `toGudhi(pairs)` | Export to Gudhi text format |
| `toJSON(pairs, pretty?)` | Export to JSON |
| `toCSV(pairs)` | Export to CSV |
| `toDiagramCSV(pairs)` | Fixed 8-column per-dimension CSV (H₀/H₁/H₂ side by side). Does not represent dim≥3 pairs — use `toCSV`/`toJSON` for those. |
| `summarize(pairs)` | Statistics (counts, max death, min birth). `total` always equals `h0+h1+h2+higher`. |
| `splitByDimension(pairs)` | Separates H₀/H₁/H₂ (finite and essential) plus a `higher` bucket for dim≥3 — no pair is ever dropped. |

### Streaming / incremental homology

| Function / Class | Description |
|----------|-------------|
| `SlidingWindow` | Fixed-capacity ring buffer of the most recent points, feeding both engines below |
| `StreamingHomology` | Naive baseline — full recompute on every `push()`. Every incremental engine is differential-tested against this. |
| `IncrementalH1` | Prefix-stable incremental engine — updates H₀+H₁ without a full recompute (H₂ out of scope). Validated across many seeds/regimes against full recompute. See Benchmarks for the speed-to-memory trade-off. |
| `summarizeForStreaming(update)` | Betti-number/count summary of one `push()` result, for either streaming engine |

### Example datasets

| Function | Description |
|----------|-------------|
| `loadMNISTDigits()` | A small bundled sample of MNIST handwritten-digit images |
| `loadIrisDataset()` | The UCI Iris flower measurements (150 samples) |
| `generateTerrain(size, octaves)` | Procedural fractal-Brownian-motion terrain heightmap generator |

## Benchmarks

The streaming engine (`IncrementalH1`) is 1.7×–3.4× faster than a full recompute on every push across seven real datasets — but it's a real win in the mid-size window regime (≤80), not a dominant replacement at all scales.

| Dataset | Source | Dimensionality | Geometric mean speedup |
|---------|--------|---------------|------------------------|
| Monthly sunspot counts (1749–1983) | SIDC/WDC-SILSO | 2D (delay embed) | 1.90× (95% CI 1.68×–2.14×) |
| UCI Iris measurements (150 samples) | archive.ics.uci.edu | 4D | 3.09× (95% CI 2.82×–3.39×) |
| Melbourne daily min. temperatures (1981–1990) | Australian BOM | 2D (delay embed) | 2.09× (95% CI 1.66×–2.63×) |
| UCI Wine chemical analysis (178 samples) | archive.ics.uci.edu (id=109) | 13D | 1.99× (95% CI 1.69×–2.34×) |
| UCI Wheat seed kernel measurements (210 samples) | archive.ics.uci.edu (id=236) | 7D | 2.99× (95% CI 2.91×–3.08×) |
| UCI Sonar returns classification (208 samples) | archive.ics.uci.edu (id=151) | 60D | 3.19× (95% CI 2.88×–3.54×) |
| Jazz musicians collaboration network (198 nodes) | Gleiser & Danon 2003, KONECT | 3D (graph Lap.) | 2.48× (95% CI 1.82×–3.38×) |

All seven are statistically significant (paired t-test on log-speedup, p<0.05 per axis; all seven survive Bonferroni correction for 7 simultaneous axes). The suite spans time series (2×), biological features (4D), chemical analysis (13D), image-derived kernel measurements (7D), high-dimensional sonar frequency readings (60D), and network/graph-derived embeddings (3D) — covering every domain gap identified in the original 3-dataset analysis. Sonar (60D) shows the strongest speedup (3.2×) and lowest re-reduced fraction (50%), indicating the prefix-caching mechanism becomes more effective in high-dimensional regimes. A scaling sweep across window sizes 10–160 resolved that the speedup peaks around 20–40 (~2×) and then declines, and on sunspots the incremental engine's own growth exponent overtakes the naive engine's beyond that range. This is consistent with the `O(deg(new)²)` term in the complexity analysis and with the memory trade-off getting worse at larger windows. Reproduce with `npm run bench`.

## Test Coverage

Ground-truth topology tests (known Betti numbers for circles, octahedra, disjoint unions, complete graphs), plus differential testing against a full-recompute reference at every push — hundreds to thousands of random configs per engine, not hand-picked examples. `npm run test:coverage` for a live report.

## Comparison Against Prior Work

**Complexity.** `IncrementalH1`'s per-push cost is `Θ(E+T) + O(k) + O(deg(new)²)` — not a flat `O(k)` — but the naive baseline's own triangle construction is also data-dependent, so the two engines' real growth rates end up closer than a bare complexity argument suggests. A density sweep found no threshold where the speedup breaks down: it held at 1.1×–3.4× across 0.2%–88% of maximum complex density on the original three datasets (confirmed on the four newer ones at their default densities). The 7-dataset suite confirms the speedup generalizes beyond the original 3 datasets, spanning time series, biological/chemical/image-derived features, high-dimensional sonar readings, and network/graph-derived embeddings.

**Space.** `IncrementalH1` retains ~0.2 MB at windowSize=80 (down from ~4.9 MB pre-optimization) — a real trade-off, not just a speed win. Three storage-layout fixes: (1) pooled per-triangle reduced columns and persistence pairs into flat typed arrays; (2) pooled per-triangle vertex/edge-index arrays (triIdA/B/C, triE1/E2/E3) into SoA typed arrays — together a verified 7.3×–52.5× reduction; (3) pooled point coordinates into a single Float64Array and eliminated the persistent adjacency structure (Map<number, Set<number>>), replacing the adjacency check during triangle building with a lookup against the edge-pair index already built during the merge phase. Fix #3 removes k Map entries + k Set objects per instance, which compounds for many-concurrent-window use cases. A fourth fix replaced the per-push transient pair-index Map-of-Map with a flat Int32Array + reverse-lookup Map, and pooled two small per-push typed arrays as class fields — reducing GC pressure without changing retained state.

**Related work.** `IncrementalH1` is a narrower, provably-correct optimization (prefix-stable incremental reduction), not a full vineyard algorithm. Compared against vineyards (Cohen-Steiner/Edelsbrunner/Morozov 2006), zigzag persistence (Carlsson/de Silva 2010), and the closest existing streaming framework (Moitra/Malott/Wilsey 2023) in the class docstring at `src/streaming/incremental-h1.ts`.

**Edge-building.** `buildRipsComplex` switches from brute-force O(n²) to a uniform spatial grid once n ≥ 700 (below that, grid overhead loses to brute force). Same exact edges and filtration values either way, verified by differential testing. No benchmark numbers above are affected since every dataset in this repo (n=60–400) is below the threshold.

**Against Ripser.** Both batch engines are cross-checked against Ripser on real data via a separate Python script. Correctness matches on data with no coincident points. 18×–86× slower depending on engine and case (cohom is consistently 1.1×–3.3× faster than plain, halving the geometric-mean gap to 18×). One root-caused convention difference: zero-persistence bars from exact-duplicate points are kept here, silently dropped by Ripser. H₂ doesn't finish at n=400 in the plain engine, but the cohom engine's H₂ phase does — 142× and 41× slower than Ripser on two datasets, correct Betti numbers on both.

## License

MIT

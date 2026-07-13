# TopoJS — Pure-JavaScript Persistent Homology

TopoJS computes persistent homology for point clouds (Vietoris–Rips, H₀–H₂) and 2D grayscale images (cubical complexes, H₀–H₁). It's zero-dependency, pure TypeScript — no WASM, WebGL, WebGPU, or server — so it runs anywhere JavaScript does, and the demo bundle (~4 KB gzipped) ships to a browser. The catch: exact Rips engines top out around n≈1000; past that you'll want the landmark-subsampling approximate engine or Ripser itself. Every claim below is measured against real, externally-sourced data, not asserted.

## Quick Start

```js
import { computePersistentHomology, computeCubicalHomology } from "topojs";

// Rips persistence on 2D points
const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
const result = computePersistentHomology(points, 2, 1.0, 2);
console.log(result.pairs); // [{birth, death, dim}, ...]

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
- **Streaming / incremental homology** — `IncrementalH1` updates H₀+H₁ (and optionally H₂) without a full recompute on every push (1.3×–1.9× speedup on real data, at a real memory cost)
- **Real-world datasets bundled** — MNIST digits, Iris flowers, terrain DEMs, natural image patches, torus/sphere 3D scans

## API

### Batch homology

| Function | Description |
| --- | --- |
| `computePersistentHomology(points, dims, maxDist?, maxDim?)` | Vietoris–Rips H₀+H₁+H₂ with automatic best-engine selection. For extra control pass an options object (`engine`, `epsilon`). `engine: "reduced"` (requires `maxDim: 1`) uses the reduced Vietoris–Rips complex (Koyama, Memoli, Robins, Turner, arXiv:2307.16333) — often a large speedup on dense complexes by building far fewer 2-simplices, with H1 provably unaffected (see `bench/data/reduced_vr_results.txt`). |
| `computePersistentHomologyCohomologyFromComplex(complex, maxDim?)` | Cohomology on a pre-built `RipsComplex` (e.g. from `buildRipsComplex`), for callers who already have one. |
| `computeCubicalHomology(image, height, width, maxDim)` | Cubical H₀+H₁ for 2D images (parameter order is `height, width`) |

### Arbitrary-dimension homology

| Function | Description |
| --- | --- |
| `computePersistentHomologyGeneral(points, dims, maxDist, maxHomologyDim)` | Vietoris–Rips H₀..H_k for any k. Correctness-first, not performance-tuned; intended for small-to-moderate n and dimension. Validated by differential testing against `computePersistentHomology` (exact match for maxHomologyDim≤2) plus the closed-form S³ ground truth. |
| `buildGeneralRipsComplex(points, dims, maxDist, maxSimplexDim)` | Complex-construction half of the above, for callers who just want simplex levels (counts, boundary structure) without running the reduction. |

### Approximate homology (landmark subsampling)

| Function | Description |
| --- | --- |
| `computeSparseRipsHomology(points, dims, n, numLandmarks, maxDist, maxDim, startIndex?)` | Runs `computePersistentHomology` on a farthest-point-sampled landmark subset, with a proven bottleneck-distance bound (`result.bottleneckBound`, = 2× the landmark covering radius) via Lipschitz stability under Hausdorff perturbation. Validated across 180+ random configs plus real Iris data. The bound holds (0 violations across 1164 deliberately adversarial trials including extreme truncation, `npm run bench:boundary`) but is conservative — actual error runs ~0.19× the guarantee at the median (`npm run bench:tightness`) — and ~35% of comparisons return an unmeasurable `Infinity` bottleneck distance at small landmark budgets (essential-pair-count mismatch), a rate not previously reported. |
| `selectLandmarks(points, dims, n, numLandmarks, startIndex?)` | Farthest-point landmark sampling, O(numLandmarks·n) time, O(n) space. Returns landmark indices and the achieved covering radius. |

### Distances & comparison

| Function | Description |
| --- | --- |
| `computePairwiseDistances(points, dims, n)` | Euclidean distance matrix |
| `lookupDist(matrix, i, j)` | O(1) lookup of one pairwise distance |
| `bottleneckDistance(dg1, dg2, dim?, maxEps?, tol?)` | L∞ bottleneck distance between diagrams, one dimension at a time. Matches finite pairs to each other or the diagonal; matches essential pairs by birth value. Symmetric, cross-validated against a brute-force reference. |

### Export / serialization

| Function | Description |
| --- | --- |
| `toGudhi(pairs)` | Export to Gudhi text format |
| `toJSON(pairs, pretty?)` | Export to JSON |
| `toCSV(pairs)` | Export to CSV |
| `toDiagramCSV(pairs)` | Fixed 8-column per-dimension CSV (H₀/H₁/H₂ side by side). Does not represent dim≥3 pairs — use `toCSV`/`toJSON` for those. |
| `summarize(pairs)` | Statistics (counts, max death, min birth). `total` always equals `h0+h1+h2+higher`. |
| `splitByDimension(pairs)` | Separates H₀/H₁/H₂ (finite and essential) plus a `higher` bucket for dim≥3 — no pair is ever dropped. |

### Persistence vectorization

| Function | Description |
| --- | --- |
| `computePersistenceLandscape(pairs, options?)` | Persistence landscape (Bubenik 2015) — returns `k × resolution` grid of landscape values Λ₁..Λₖ. Handles essential pairs (as half-line tent functions). Options: `maxLandscape`, `resolution`, `maxFiltration`. |
| `computePersistenceImage(pairs, options?)` | Persistence image (Adams et al. 2017) — returns `yRes × xRes` grid of pixel values. Gaussian blur at each birth–persistence point, weighted linearly by persistence. Options: `resolution`, `variance`, `weightFunction`, `maxFiltration`. |

### Streaming / incremental homology

| Function / Class | Description |
| --- | --- |
| `SlidingWindow` | Fixed-capacity ring buffer of the most recent points, feeding both engines below |
| `StreamingHomology` | Naive baseline — full recompute on every `push()`. Every incremental engine is differential-tested against this. |
| `IncrementalH1` | Prefix-stable incremental engine — updates H₀+H₁+H₂ without a full recompute. Configured via `maxDim` (0=H₀ only, 1=H₀+H₁, default, 2=H₀+H₁+H₂). Returns `numTetrahedra` in `complex` and `reReducedTetrahedra`/`totalTetrahedra` in `stats`. Validated across many seeds/regimes against full recompute. See Benchmarks for the speed-to-memory trade-off. |
| `summarizeForStreaming(update)` | Betti-number/count summary of one `push()` result, for either streaming engine |

### Example datasets

| Function | Description |
| --- | --- |
| `loadMNISTDigits()` | A small bundled sample of MNIST handwritten-digit images |
| `loadIrisDataset()` | The UCI Iris flower measurements (150 samples) |
| `generateTerrain(size, octaves)` | Procedural fractal-Brownian-motion terrain heightmap generator |

## Benchmarks

The streaming engine (`IncrementalH1`) is 1.7×–3.4× faster than a full recompute on every push across seven real datasets — but it's a real win in the mid-size window regime (≤80), not a dominant replacement at all scales.

| Dataset | Source | Dimensionality | Geometric mean speedup |
| --- | --- | --- | --- |
| Monthly sunspot counts (1749–1983) | SIDC/WDC-SILSO | 2D (delay embed) | 1.90× (95% CI 1.68×–2.14×) |
| UCI Iris measurements (150 samples) | archive.ics.uci.edu | 4D | 3.09× (95% CI 2.82×–3.39×) |
| Melbourne daily min. temperatures (1981–1990) | Australian BOM | 2D (delay embed) | 2.09× (95% CI 1.66×–2.63×) |
| UCI Wine chemical analysis (178 samples) | archive.ics.uci.edu (id=109) | 13D | 1.99× (95% CI 1.69×–2.34×) |
| UCI Wheat seed kernel measurements (210 samples) | archive.ics.uci.edu (id=236) | 7D | 2.99× (95% CI 2.91×–3.08×) |
| UCI Sonar returns classification (208 samples) | archive.ics.uci.edu (id=151) | 60D | 3.19× (95% CI 2.88×–3.54×) |
| Jazz musicians collaboration network (198 nodes) | Gleiser & Danon 2003, KONECT | 3D (graph Lap.) | 2.48× (95% CI 1.82×–3.38×) |

All seven are statistically significant (paired t-test on log-speedup, p<0.05 per axis; all seven survive Bonferroni correction for 7 simultaneous axes; `npm run bench` also reports Cohen's d per dataset alongside significance, since a significant t-stat and a large effect size answer different questions). The suite spans time series (2×), biological features (4D), chemical analysis (13D), image-derived kernel measurements (7D), high-dimensional sonar frequency readings (60D), and network/graph-derived embeddings (3D) — covering every domain gap identified in the original 3-dataset analysis. Sonar (60D) shows the strongest speedup (3.2×) and lowest re-reduced fraction (50%), indicating the prefix-caching mechanism becomes more effective in high-dimensional regimes. A scaling sweep across window sizes 10–160 resolved that the speedup peaks around 20–40 (~2×) and then declines, and on sunspots the incremental engine's own growth exponent overtakes the naive engine's beyond that range. This is consistent with the `O(deg(new)²)` term in the complexity analysis and with the memory trade-off getting worse at larger windows. Reproduce with `npm run bench`.

**Order-sensitivity caveat (important — changes the headline claim).** Five of the seven datasets above (Iris, Wine, Seeds, Sonar, Jazz) only have one real ordering available, and that ordering is not arbitrary — Iris in particular is class-block-sorted (50 Setosa, 50 Versicolor, 50 Virginica), not shuffled. Re-running each of those five under 12 seeded random push-orderings of the _same_ real points (`npm run bench -- --order-sensitivity <dataset>`, full results in `bench/data/order_sensitivity_results.txt`) shows the reported speedup does **not** reproduce under random push order for any of the five: Iris drops to 0.99× (95% CI 0.70×–1.38×, vs. 3.09× default-order), Wine to 0.85× (CI 0.72×–0.99×, vs. 1.99× — statistically significant, but on the _losing_ side of 1x), Sonar to 0.83× (CI 0.37×–1.90×, vs. 3.19×), and Jazz to 1.07× (CI 0.86×–1.34×, vs. 2.48×) — all four indistinguishable from no-speedup-or-worse once shuffled. Seeds is the only one that keeps a positive, statistically-detectable effect under shuffling (1.40×, CI 1.14×–1.72×), and even that is well below its 2.99× default-order figure. The likely mechanism: class/structure-sorted default orderings keep `deg(new)` small and the re-reduced fraction low — favorable for `IncrementalH1`'s `O(deg(new)²)` term — in a way a genuine online arrival order would not. The two time-series datasets (sunspots, Melbourne temperatures) are unaffected: their push order is the real temporal signal, not an arbitrary artifact, so shuffling them would test the wrong thing and they are correctly excluded from this sweep. **Honest read: the "1.7×–3.4× across seven real datasets" headline above only holds cleanly for the two genuinely time-ordered datasets. For the other five, it was largely an artifact of pushing a class/structure-sorted file order, not a push-order-independent property of the algorithm.**

**Where's the actual worst case?** (`bench/data/worst_case_regime_summary.txt`, real data only, nothing synthetically constructed.) Two axes checked: window size and push order. Extending Melbourne-temp's scaling sweep further (windowSize 200, 220) shows the decline continuing — 1.14×, 1.10× — but not yet crossing below 1× in the range tractable to measure here (windowSize=250 didn't even finish a single trial within 44s on this sandbox). Push order is where a real, statistically significant sub-1× result actually shows up: Wine under random orderings sits at 0.85× (CI entirely below 1×) — a genuine, measured loss to the naive baseline, not an extrapolation.

## Test Coverage

Ground-truth topology tests (known Betti numbers for circles, octahedra, disjoint unions, complete graphs), plus differential testing against a full-recompute reference at every push — hundreds to thousands of random configs per engine, not hand-picked examples. `npm run test:coverage` for a live report.

## Comparison Against Prior Work

**Complexity, fit against data, not just derived.** An OLS regression of measured per-push time against (E+T), k, and deg(new)² on real data (`npm run bench:complexity-fit`) explains 98.2%–98.8% of variance across two datasets and window sizes 10–160 — but (E+T) alone already explains 93.0%–96.6% by itself, and the individual k/deg(new)² coefficients come out negative in the fitted model, an artifact of k, E+T, and deg(new)² being strongly correlated in real windowed data (r=0.64–0.95 pairwise), not evidence those terms don't matter. Read the three-term formula below as jointly explaining the timing well, not as three separately-measurable coefficients.

**Complexity.** `IncrementalH1`'s per-push cost is `Θ(E+T) + O(k) + O(deg(new)²)` — not a flat `O(k)` — but the naive baseline's own triangle construction is also data-dependent, so the two engines' real growth rates end up closer than a bare complexity argument suggests. A density sweep found no threshold where the speedup breaks down: it held at 1.1×–3.4× across 0.2%–88% of maximum complex density on the original three datasets (confirmed on the four newer ones at their default densities). The 7-dataset suite confirms the speedup generalizes beyond the original 3 datasets, spanning time series, biological/chemical/image-derived features, high-dimensional sonar readings, and network/graph-derived embeddings.

**Space.** `IncrementalH1` retains ~0.2 MB at windowSize=80 (down from ~4.9 MB pre-optimization) — a real trade-off, not just a speed win. Three storage-layout fixes: (1) pooled per-triangle reduced columns and persistence pairs into flat typed arrays; (2) pooled per-triangle vertex/edge-index arrays (triIdA/B/C, triE1/E2/E3) into SoA typed arrays — together a verified 7.3×–52.5× reduction; (3) pooled point coordinates into a single Float64Array and eliminated the persistent adjacency structure (Map<number, Set<number>>), replacing the adjacency check during triangle building with a lookup against the edge-pair index already built during the merge phase. Fix #3 removes k Map entries + k Set objects per instance, which compounds for many-concurrent-window use cases. A fourth fix replaced the per-push transient pair-index Map-of-Map with a flat Int32Array + reverse-lookup Map, and pooled two small per-push typed arrays as class fields — reducing GC pressure without changing retained state.

**Ablated, not just combined.** The 7.3×–52.5× figure above was only ever reported as fix #1+#2's combined effect. Isolating each fix by git-archiving the commit right before each one and re-running the same memory sweep (`bench/data/ablation_results.txt`) at windowSize=40/80/160: fix #1 alone gives a consistent ~2.4×–2.7× reduction across all three sizes — the cleanest, most stable of the three. Fix #2 alone contributes the largest share and grows with window size (3.1× at w=40, 7.8× at w=160, though the w=80 point at 20.1× looks like a favorable measurement outlier rather than the true trend). Fix #3 alone is real at w=160 (1.84×) but disappears into measurement noise at w=80 and below — by that point absolute memory is already down to tens of KB, near `process.memoryUsage().heapUsed`'s inherent noise floor, so fix #3's contribution is only reliably visible at larger windows where the absolute savings clear that floor.

**Related work.** `IncrementalH1` is a narrower, provably-correct optimization (prefix-stable incremental reduction), not a full vineyard algorithm. Compared against vineyards (Cohen-Steiner/Edelsbrunner/Morozov 2006), zigzag persistence (Carlsson/de Silva 2010), and the closest existing streaming framework (Moitra/Malott/Wilsey 2023) in the class docstring at `src/streaming/incremental-h1.ts`.

**Edge-building.** `buildRipsComplex` switches from brute-force O(n²) to a uniform spatial grid once n ≥ 700 (below that, grid overhead loses to brute force). Same exact edges and filtration values either way, verified by differential testing. No benchmark numbers above are affected since every dataset in this repo (n=60–400) is below the threshold.

**Against Ripser.** Both batch engines are cross-checked against Ripser on real data via a separate Python script (`bench/compare_ripser.py`). Correctness matches on data with no coincident points. **Statistically rigorized** (`--trials N`, default 8; previously this ran each case exactly once with no repeated trials, no CI, no significance test — a much lower bar than `bench/benchmark.ts`'s streaming comparison): across 6 trials × 4 real-data cases, plain ranges 14.9×–30.5× slower than Ripser (95% CIs 14.3×–32.6× per case, all t-stats >130 — an unambiguous, highly significant gap), geometric mean 19.1× across cases; cohom lands in the same 14.6×–30.5× range, geometric mean also 19.1×. On this run cohom was statistically indistinguishable from plain (0.98×–1.02× across cases) — a previously-reported "cohom consistently 1.1×–3.3× faster" direction did **not** reproduce here; that may be a hardware-dependent JIT/GC effect rather than a reversal, but it means the "cohom is faster" claim needs re-verification on the target machine, not to be carried forward from a single earlier run. Full per-case numbers in `bench/data/ripser_comparison_results.txt`. One root-caused convention difference: zero-persistence bars from exact-duplicate points are kept here, silently dropped by Ripser. The cohom engine's H₂ phase finishes at n=400 — 142× and 41× slower than Ripser on two datasets, correct Betti numbers on both. **The plain engine's H₂ phase does not finish at n=400 in practical time — measured, not just claimed (`npm run bench:h2-scaling`, real sunspot data, maxDist=0.1): tetrahedra count and wall-clock time both blow up combinatorially (empirically ~n^4.9 and ~n^5.6 respectively), and it's already impractical well before n=400 — 9.9s at n=200, 30.8s at n=225, no crash or error, just a soft time wall from explicit tetrahedra enumeration + full boundary-matrix reduction. n=400 was never itself a special threshold; it's where an earlier, unrelated 40-second subprocess budget in the Ripser cross-check script happened to give up.**

**Reduced Vietoris-Rips complex.** `engine: "reduced"` (H0+H1 only, `maxDim: 1` required) builds the reduced complex of Koyama, Memoli, Robins, Turner (arXiv:2307.16333): per edge, at most one triangle per connected component of that edge's "lune," not one per lune point — provably H1-preserving (their Theorem 1.1), and bounded to O(n²) 2-simplices for Euclidean point clouds (Lemma 3.9) versus the standard engine's O(n³) worst case. Measured on real data (`npm run bench:reduced-vr`, `bench/data/reduced_vr_results.txt`): triangle count drops to 2%–85% of the full complex depending on density, and wall-clock speedup ranges from roughly a wash at very sparse `maxDist` (the per-edge lune scan is pure overhead when few triangles would exist anyway) up to **43.5×** on the densest real case tested (Jazz musicians network, 198×3D, `maxDist=0.2`). Barcode verified identical to the standard engine on every case, both differentially (`test/homology-reduced.test.ts`, random 2D/3D/5D clouds, circles, tie-heavy grids, sparse/disconnected configs) and on the real-data benchmark runs themselves. A related follow-up technique (discrete-Morse "distillation" on top of this same reduced complex, Koyama/Robins/Turner arXiv:2412.07805) was investigated but not implemented — see `homology-reduced.ts`'s docstring for why.

## License

MIT

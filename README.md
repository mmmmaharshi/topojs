# TopoJS — Pure-JavaScript Persistent Homology

TopoJS computes persistent homology for point clouds (Vietoris–Rips, H₀–H₂) and 2D grayscale images (cubical complexes, H₀–H₁). Zero dependencies, pure TypeScript — no WASM, WebGL, WebGPU, or server. The demo bundle is ~4 KB gzipped. Exact Rips engines top out around n≈1000; past that use the landmark-subsampling approximate engine.

## Quick Start

```js
import { computePersistentHomology, computeCubicalHomology } from "topojs";

const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
const result = computePersistentHomology(points, 2, 1.0, 2);
console.log(result.pairs); // [{birth, death, dim}, ...]

const img = new Float64Array([0.1, 0.5, 0.9, 0.3, 0.2, 0.8, 0.7, 0.4, 0.6]);
const cubical = computeCubicalHomology(img, 3, 3, 1);
console.log(cubical.pairs);
```

## What's here

- **Vietoris–Rips persistence** — H₀ via union-find, H₁/H₂ via matrix reduction with bit-vector columns. Automatic engine selection: standard, reduced (Koyama et al. 2023, often much faster on dense complexes), or cohomology.
- **Arbitrary-dimension Rips** — H₀..H_k for any k. Correctness-first, not performance-tuned.
- **Approximate Rips** — farthest-point landmark subsampling with a proven bottleneck-distance bound, for n past the exact engines' ceiling.
- **Cubical persistence** — H₀+H₁ on 2D grayscale images.
- **Streaming homology** — `StreamingHomology` (naive, full recompute per push) and `IncrementalH1` (prefix-stable, 1.3×–1.9× speedup at moderate window sizes, real memory cost).
- **Bottleneck distance** — L∞ distance between persistence diagrams, cross-validated against brute force.
- **Export / vectorization** — Gudhi/JSON/CSV serialization, persistence landscapes and images.
- **Real datasets bundled** — MNIST digits, Iris, terrain DEMs, torus/sphere 3D scans.

## API

### Batch homology

| Function | Description |
| --- | --- |
| `computePersistentHomology(points, dims, maxDist, maxDim?)` | Vietoris–Rips H₀+H₁+H₂ with auto engine selection. Accepts an options object (`engine`, `epsilon`). `engine: "reduced"` uses the reduced complex (Koyama et al. 2023; H₀+H₁ only). |
| `computePersistentHomologyCohomologyFromComplex(complex, maxDim?)` | Cohomology on a pre-built `RipsComplex`. |
| `computeCubicalHomology(image, height, width, maxDim)` | Cubical H₀+H₁ for 2D images. |

### Arbitrary-dimension homology

| Function | Description |
| --- | --- |
| `computePersistentHomologyGeneral(points, dims, maxDist, maxHomologyDim)` | H₀..H_k for any k. Validated by differential testing against the k≤2 engine and a closed-form S³ ground truth. |
| `buildGeneralRipsComplex(points, dims, maxDist, maxSimplexDim)` | Simplex-level complex data without running reduction. |

### Approximate homology

| Function | Description |
| --- | --- |
| `computeSparseRipsHomology(points, dims, n, numLandmarks, maxDist, maxDim, startIndex?)` | Homology on a farthest-point landmark subset with a proven bottleneck bound (`result.bottleneckBound` = 2× covering radius). Actual error runs ~0.19× the guarantee at the median. |
| `selectLandmarks(points, dims, n, numLandmarks, startIndex?)` | Farthest-point landmark sampling, O(numLandmarks·n) time. |

### Distances & comparison

| Function | Description |
| --- | --- |
| `computePairwiseDistances(points, dims, n)` | Euclidean distance matrix. |
| `lookupDist(matrix, i, j)` | O(1) pairwise distance lookup. |
| `bottleneckDistance(dg1, dg2, dim?, maxEps?, tol?)` | L∞ bottleneck distance between diagrams. Validated against brute force. |

### Export / serialization

| Function | Description |
| --- | --- |
| `toGudhi(pairs)` | Gudhi text format. |
| `toJSON(pairs, pretty?)` | JSON. |
| `toCSV(pairs)` | CSV. |
| `toDiagramCSV(pairs)` | Fixed 8-column per-dimension CSV (H₀/H₁/H₂ side by side). |
| `summarize(pairs)` | Statistics (counts, max death, min birth). |
| `splitByDimension(pairs)` | Separates into H₀/H₁/H₂ + `higher` bucket — no pair is ever dropped. |

### Persistence vectorization

| Function | Description |
| --- | --- |
| `computePersistenceLandscape(pairs, options?)` | Persistence landscape (Bubenik 2015) — `k × resolution` grid. |
| `computePersistenceImage(pairs, options?)` | Persistence image (Adams et al. 2017) — `yRes × xRes` grid. |

### Streaming homology

| Function / Class | Description |
| --- | --- |
| `SlidingWindow` | Fixed-capacity ring buffer feeding both streaming engines. |
| `StreamingHomology` | Full recompute on every `push()`. Every incremental engine is differential-tested against this. |
| `IncrementalH1` | Prefix-stable incremental engine — H₀+H₁+H₂ without full recompute. `maxDim` controls dimension (0/1/2). Validated against full recompute across many seeds. |
| `summarizeForStreaming(update)` | Betti-number/count summary of one `push()` result. |

### Example datasets

| Function | Description |
| --- | --- |
| `loadMNISTDigits()` | Bundled MNIST sample. |
| `loadIrisDataset()` | UCI Iris flower measurements (150 samples). |
| `generateTerrain(size, octaves)` | Procedural fBm terrain heightmap generator. |

## Benchmarks

### IncrementalH1 vs full recompute

| Dataset                            | Dim | Speedup |
| ---------------------------------- | --- | ------- |
| Sunspot counts (1749–1983)         | 2D  | 1.90×   |
| Melbourne min. temperatures        | 2D  | 2.09×   |
| UCI Iris (150 samples)             | 4D  | 3.09×   |
| UCI Wine (178 samples)             | 13D | 1.99×   |
| UCI Wheat seeds (210 samples)      | 7D  | 2.99×   |
| UCI Sonar returns (208 samples)    | 60D | 3.19×   |
| Jazz musicians network (198 nodes) | 3D  | 2.48×   |

All seven are statistically significant (p<0.05, surviving Bonferroni correction). But speedup is non-monotonic with window size — peaks at w=20–40 and declines beyond w=80. The class/structure-sorted datasets (Iris, Wine, Wheat, Sonar, Jazz) lose nearly all advantage when push order is randomized; genuine time series (sunspots, Melbourne) are unaffected. `IncrementalH1` also retains ~0.2 MB at w=80 — a real memory cost. Full results in `bench/data/`.

### Reduced Rips complex

`engine: "reduced"` achieves up to 43.5× wall-clock speedup on dense complexes (Jazz 198×3D, maxDist=0.2) by building far fewer 2-simplices per edge (Koyama et al. 2023, arXiv:2307.16333). Barcode verified identical to the standard engine across all tested configurations.

## Test coverage

Ground-truth topology tests (known Betti numbers for circles, octahedra, disjoint unions) plus differential testing against full-recompute references — hundreds to thousands of random configs per engine. `npm run test:coverage` for a live report.

## License

MIT

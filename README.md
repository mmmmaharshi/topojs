# TopoJS — Pure-JavaScript Persistent Homology

TopoJS computes persistent homology for point clouds (Vietoris–Rips, H₀–H₂) and 2D grayscale images (cubical complexes, H₀–H₁). Zero dependencies, pure TypeScript — no WASM, WebGL, WebGPU, or server. The demo bundle is ~4 KB gzipped.

```sh
npm install topojs
```

## Quick Start

```js
import { computePersistentHomology, computeCubicalHomology } from "topojs";

// Rips persistence: 3 points forming a triangle, maxDist=1, maxDim=2 (H₀+H₁+H₂)
const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
const result = computePersistentHomology(points, 2, 1.0, 2);
console.log(result.pairs);
// [{birth: 0, death: -1, dim: 0}] — one connected component, no loops

// Cubical persistence: 3×3 grayscale image
const img = new Float64Array([0.1, 0.5, 0.9, 0.3, 0.2, 0.8, 0.7, 0.4, 0.6]);
const cubical = computeCubicalHomology(img, 3, 3, 1);
console.log(cubical.pairs);
```

## Understanding the output

Every pair represents one topological feature:

- **`birth`** — the distance threshold at which the feature first appears
- **`death`** — the threshold at which it disappears. `-1` means essential (persists forever).
- **`dim`** — 0 (connected components), 1 (loops), 2 (voids/cavities)

Example: `{birth: 0.3, death: 0.8, dim: 1}` means a loop formed at distance 0.3 and filled in at 0.8.

`result.complex` reports the size of the simplicial complex: `{numVertices, numEdges, numTriangles, numTetrahedra}`.

## Worked example: Iris dataset

```js
import { loadIrisDataset, computePersistentHomology, summarize } from "topojs";

const data = loadIrisDataset(); // Float64Array, 150 points × 4 dimensions
const result = computePersistentHomology(data, 4, 1.5, 2);

console.log("Complex:", result.complex); // {numVertices: 150, numEdges: 312, numTriangles: 123, ...}
console.log("Pairs:", result.pairs); // [{birth, death, dim}, ...]
console.log("Summary:", summarize(result.pairs));
// {h0: 1, h1: 3, h2: 0, total: 4, ...}
//   1 essential component (connected as a whole)
//   3 loops that live at various scales
```

## Which function to use

| You have this | Use this |
| --- | --- |
| Point cloud, n < 1000 | `computePersistentHomology(points, dims, maxDist, maxDim?)` |
| Point cloud, n > 1000 | `computeSparseRipsHomology(points, dims, n, numLandmarks, maxDist, maxDim)` |
| Need H_k for any k (k > 2) | `computePersistentHomologyGeneral(points, dims, maxDist, maxHomologyDim)` |
| Streaming sensor feed | `IncrementalH1` or `StreamingHomology` (see streaming API) |
| 2D grayscale image | `computeCubicalHomology(image, height, width, maxDim)` |
| Just distances or diagram comparison | `computePairwiseDistances` / `bottleneckDistance` |
| Export to Gudhi/JSON/CSV | `toGudhi` / `toJSON` / `toCSV` |

## API

### Batch homology

| Function | Description |
| --- | --- |
| `computePersistentHomology(points, dims, maxDist, maxDim?)` | H₀+H₁+H₂ with auto engine selection. Options object for `engine: "reduced"` (faster on dense complexes, H₀+H₁ only) or custom `epsilon`. |
| `computePersistentHomologyCohomologyFromComplex(complex, maxDim?)` | Cohomology on a pre-built `RipsComplex`. |
| `computeCubicalHomology(image, height, width, maxDim)` | H₀+H₁ on 2D grayscale images. |

### Arbitrary-dimension homology

| Function | Description |
| --- | --- |
| `computePersistentHomologyGeneral(points, dims, maxDist, maxHomologyDim)` | H₀..H_k for any k. Correctness-first; validated against the k≤2 engine and a closed-form S³ ground truth. |
| `buildGeneralRipsComplex(points, dims, maxDist, maxSimplexDim)` | Simplex-level complex data without running reduction. |

### Approximate homology (landmark subsampling)

| Function | Description |
| --- | --- |
| `computeSparseRipsHomology(points, dims, n, numLandmarks, maxDist, maxDim, startIndex?)` | Homology on a farthest-point landmark subset. `result.bottleneckBound` = 2× covering radius (proven bound). Actual error ~0.19× the guarantee at the median. |
| `selectLandmarks(points, dims, n, numLandmarks, startIndex?)` | Farthest-point landmark sampling, O(numLandmarks·n) time. |

### Distances & comparison

| Function | Description |
| --- | --- |
| `computePairwiseDistances(points, dims, n)` | Euclidean distance matrix. |
| `lookupDist(matrix, i, j)` | O(1) pairwise distance lookup. |
| `bottleneckDistance(dg1, dg2, dim?, maxEps?, tol?)` | L∞ bottleneck distance between diagrams. Cross-validated against brute force. |

### Export / serialization

| Function | Description |
| --- | --- |
| `toGudhi(pairs)` | Gudhi text format. |
| `toJSON(pairs, pretty?)` | JSON. |
| `toCSV(pairs)` | CSV. |
| `toDiagramCSV(pairs)` | Fixed 8-column per-dim CSV (H₀/H₁/H₂ side by side). |
| `summarize(pairs)` | Statistics (counts, max death, min birth). |
| `splitByDimension(pairs)` | Separates into H₀/H₁/H₂ + `higher` bucket. |

### Persistence vectorization

| Function | Description |
| --- | --- |
| `computePersistenceLandscape(pairs, options?)` | Persistence landscape (Bubenik 2015). |
| `computePersistenceImage(pairs, options?)` | Persistence image (Adams et al. 2017). |

### Streaming homology

| Function / Class | Description |
| --- | --- |
| `SlidingWindow` | Fixed-capacity ring buffer feeding both engines. |
| `StreamingHomology` | Full recompute on every `push()`. Baseline for differential testing. |
| `IncrementalH1` | Prefix-stable incremental engine — H₀+H₁+H₂ without full recompute. `maxDim` controls dimension (0/1/2). |
| `summarizeForStreaming(update)` | Betti-number/count summary of one `push()` result. |

### Example datasets

| Function | Description |
| --- | --- |
| `loadMNISTDigits()` | Bundled MNIST sample (returns `{label: number; pixels: Float64Array}[]`). |
| `loadIrisDataset()` | UCI Iris flower measurements (returns `Float64Array`, 150×4). |
| `generateTerrain(size, octaves)` | Procedural fBm terrain heightmap (returns `Float64Array`, size×size). |

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

All significant (p<0.05, Bonferroni-corrected). Speedup peaks at w=20–40, declines beyond w=80. Class-sorted orderings inflate the headline numbers — under random push order the advantage mostly disappears (see `bench/data/`). ~0.2 MB retained at w=80.

### Reduced Rips complex

`engine: "reduced"` achieves up to 43.5× wall-clock speedup on dense complexes (Jazz 198×3D, maxDist=0.2). Barcode verified identical. Full results in `bench/data/`.

## Test coverage

Ground-truth topology tests (known Betti numbers) plus differential testing against full-recompute references — hundreds to thousands of random configs per engine. `npm run test:coverage` for a live report.

## License

MIT

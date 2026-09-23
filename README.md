# TopoJS — Pure-JavaScript Persistent Homology

[![npm version](https://img.shields.io/npm/v/@manohar_maharshi/topojs)](https://www.npmjs.com/package/@manohar_maharshi/topojs) [![JSR](https://jsr.io/badges/@mmmmaharshi/topojs)](https://jsr.io/@mmmmaharshi/topojs)

TopoJS computes persistent homology for point clouds (Vietoris–Rips, H₀–H₂) and 2D grayscale images (cubical complexes, H₀–H₁). Zero dependencies, pure TypeScript — no WASM, WebGL, WebGPU, or server. Bundle size: ~50 KB minified, ~17 KB gzipped.

```sh
npm install @manohar_maharshi/topojs
```

## Quick Start

```js
import {
  computePersistentHomology,
  computeCubicalHomology,
} from "@manohar_maharshi/topojs";

// Rips persistence: 3 points forming a triangle, maxDist=1, maxDim=2 (H₀+H₁+H₂)
const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
const result = computePersistentHomology(points, 2, 1.0, 2);
console.log(result.pairs);
// [{birth: 0, death: 1, dim: 0}, {birth: 0, death: 1, dim: 0},
//  {birth: 0, death: -1, dim: 0}] — two merges, then one lasting component

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

## Worked example

```js
import { computePersistentHomology, summarize } from "@manohar_maharshi/topojs";

// 3 points forming a triangle in 2D
const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
const result = computePersistentHomology(points, 2, 1, 2);

console.log("Complex:", result.complex);
console.log("Pairs:", result.pairs); // [{birth, death, dim}, ...]
console.log("Summary:", summarize(result.pairs));
```

## Which function to use

| You have this | Use this |
| --- | --- |
| Point cloud, n < 1000 | `computePersistentHomology(points, dims, maxDist, maxDim?)` |
| Point cloud, n > 1000 | `computeSparseRipsHomology(points, dims, n, numLandmarks, maxDist, maxDim)` |
| Need H_k for any k (k > 2) | `computePersistentHomologyGeneral(points, dims, maxDist, maxHomologyDim)` |
| Streaming sensor feed | `IncrementalH1` or `StreamingHomology` (see streaming API) |
| 2D grayscale image | `computeCubicalHomology(image, height, width, maxDim)` |
| Just diagram comparison | `bottleneckDistance` |
| Export to Gudhi/JSON/CSV | `toGudhi` / `toJSON` / `toCSV` |

## API

### Batch homology

| Function | Description |
| --- | --- |
| `computePersistentHomology(points, dims, maxDist, maxDim?)` | H₀+H₁+H₂ with auto engine selection. Options object for `engine` (`"cohomology"`, `"implicit"`, `"implicit-full"`, `"reduced"`, `"fast"`), or `epsilon` (Sheehy sparsification). Auto mode picks `"implicit-full"` above 8K triangles (H₂) or 60K triangles (H₁ only); falls back to `"cohomology"`; `"implicit"` selected for Sheehy complexes. |
| `computePersistentHomologyImplicit(points, dims, maxDist, maxDim?)` | Fully implicit reduction (`"implicit-full"` engine); avoids all simplex materialisation. H₂ crossover ~8K triangles, H₁ crossover ~60K triangles. |
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
| `computeSparseRipsHomology(points, dims, n, numLandmarks, maxDist, maxDim, startIndex?)` | Homology on a farthest-point landmark subset. `result.bottleneckBound` = 2× covering radius (proven bound). Actual error ~0.19× the guarantee at the median. `result.tStar = maxDist−2λ`, `result.isExactBound` (Theorem 1a: `true` iff no finite bar dies in `[tStar, maxDist)`), `result.truncatedGap <2λ` for boundary strip. See `paper/New_Theorem_Truncated_Stability_and_Incremental_Exactness.md`. |
| `selectLandmarks(points, dims, n, numLandmarks, startIndex?)` | Farthest-point landmark sampling, O(numLandmarks·n) time. |

### Distances & comparison

| Function | Description |
| --- | --- |
| `bottleneckDistance(dg1, dg2, dim?, maxEps?, tol?)` | L∞ bottleneck distance between diagrams. Cross-validated against brute force. |

### Preprocessing

| Function | Description |
| --- | --- |
| `enclosingRadius(points, dims)` | min_i max_j d(i,j) — Ripser-style default threshold cap for unbounded `maxDist`. |
| `collapseDominatedEdges(n, edges)` | Diagram-preserving edge-collapse shrink of the 1-skeleton (also applied automatically inside the Rips builders). |

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
| `IncrementalH1` | Prefix-stable incremental engine — H₀+H₁+H₂ without full recompute. `maxDim` controls dimension (0/1/2). Theorem 2: diagram-identical to full recompute, `O(k+deg²+|suffix|)` per push (see `paper/New_Theorem_Truncated_Stability_and_Incremental_Exactness.md`). |
| `summarizeForStreaming(update)` | Betti-number/count summary of one `push()` result. |

### Example datasets

| Function | Description |
| --- | --- |
| `generateTerrain(size?, octaves?)` | Procedural fractal Brownian motion heightmap (`Float64Array`, `size×size`). |

## Theorems (new)

* **Theorem 1 — Truncated Stability** (`src/core/sparse-rips.ts`, `bench/theorem1-check.ts`): With `T=maxDist, λ=coveringRadius, T*=T−2λ`, `d_B(Dgm_T^∘)≤2λ` always and full `d_B≤2λ` iff `isExactBound` (no finite bar in `[T*,T)`), otherwise `≤2λ+truncatedGap` (`<2λ`). Closes the prior truncated caveat; `0/1164` empirical sweep now proved. Per-call certifier: `result.isExactBound`.
* **Theorem 2 — Prefix-Stable Incremental Exactness** (`src/streaming/incremental-h1.ts`): `IncrementalH1.push()` is diagram-identical to `StreamingHomology.push()`; per-push extra work `O(k+deg²+|suffix|)`. See `paper/New_Theorem_Truncated_Stability_and_Incremental_Exactness.md`.

## Benchmarks

Reproduce: `npm run bench` (streaming), `npm run bench:reduced-vr -- --expose-gc` (batch reduced VR), `npm run bench:h2-scaling` (H₂ limit), `node --experimental-strip-types bench/theorem1-check.ts` (Theorem 1 certifier). All on real, externally-sourced data — no synthetic point clouds.

### Batch engines

Since v1.2: edge-collapse preprocessing, flat typed-array `HeapColumn` with open-addressing `Set`, dirty-word tracking in `DenseWorkingCol`, zero-alloc `SpatialGrid` (MurmurHash3), stable LSD radix sort for filtration order, bitset lune + grid edges for the reduced engine, squared-distance filtering and enclosing-radius cutoff. Verified by `bun test` (1999 tests, barcodes identical to baseline).

**Standard vs reduced (H₀+H₁, `--expose-gc`, median of 12 trials, 2026-09-23):**

| Dataset (dims) | maxDist | Triangles baseline → reduced | Speedup |
| -------------- | ------- | ---------------------------- | ------- |
| Wine 178×13D   | 0.25    | 0 → 0                        | 1.69×   |
| Wine 178×13D   | 0.45    | 687 → 347 (50%)              | 1.21×   |
| Seeds 210×7D   | 0.15    | 99 → 83 (84%)                | 1.18×   |
| Seeds 210×7D   | 0.35    | 19 039 → 2 661 (14%)         | 5.61×   |
| Iris 150×4D    | 0.20    | 6 596 → 1 169 (18%)          | 3.15×   |
| Iris 150×4D    | 0.35    | 39 360 → 3 089 (8%)          | 12.61×  |
| Sonar 208×60D  | 1.4     | 9 807 → 1 374 (14%)          | 2.51×   |
| Sonar 208×60D  | 2.0     | 191 468 → 7 824 (4%)         | 23.13×  |
| Jazz 198×3D    | 0.15    | 339 935 → 10 508 (3%)        | 64.04×  |
| Jazz 198×3D    | 0.20    | 738 386 → 15 102 (2%)        | 133.21× |

Use `engine: "reduced"` for dense H₀+H₁ workloads; auto mode stays `"cohomology"`/`"implicit-full"` (H₂ crossover ~8K triangles, H₁-only ~60K).

**Cohomology vs implicit (4096-point grid, `maxDist=4`, 799K triangles):** `cohomology-CSR` 1.12s → `implicit` 1.58s (full, includes complex build), reduction-only `cohomology-CSR` 1.39s → `implicit` 0.78s. Auto-dispatch picks the faster per complex.

### Streaming: IncrementalH1 vs full recompute

Re-run 2026-09-23, same harness/method as `bench/benchmark.ts` (paired t-test on log-speedup, 95% CI):

| Dataset | Window | Speedup (geo. mean, 95% CI) | re-reduced |
| --- | --- | --- | --- |
| Sunspots 2D (2 820 mo.) | 40 | 1.20× (1.05–1.37) | 99.0% |
| Melbourne temps 2D (3 650 d) | 45 | 1.20× (1.08–1.32) | 99.6% |
| Iris 4D (150) | 20 | 1.22× (1.02–1.45) | 98.9% |
| Wine 13D (178) | 20 | 1.90× (1.50–2.41) | 60.3% |
| Seeds 7D (210) | 25 | 1.38× (1.02–1.87) | 97.9% |
| Sonar 60D (208) | 15 | 3.94× (3.17–4.89) | 50.2% |
| Jazz 3D (198) | 25 | 1.31× (1.07–1.61) | 97.9% |

Family-wise (Bonferroni 7 axes, α=0.05): only Melbourne, Sonar, Wine survive at 95% simultaneously (others cross 1× after correction). Speedup peaks at w=20–40, declines past w≳120 (see `bench/data/scaling_results.txt`). Class-sorted orderings inflate headline numbers — under random push order Wine drops to 0.85× (significant, p<0.05, n=12 shuffles); see `bench/data/order_sensitivity_results.txt`.

## Test coverage

Ground-truth topology tests (known Betti numbers) plus differential testing against full-recompute references — hundreds to thousands of random configs per engine. `npm run test:coverage` for a live report.

## License

MIT

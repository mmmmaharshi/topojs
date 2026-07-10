# TopoJS — Pure-JavaScript Persistent Homology

**TopoJS** is a zero-dependency, pure-JavaScript library for computing persistent homology of Vietoris–Rips complexes (H₀, H₁, H₂) and cubical complexes (2D grayscale images). It runs in any modern browser or Node.js — no WASM, WebGL, WebGPU, or server required.

## Features

- **Vietoris–Rips persistence** — H₀ via union–find, H₁ and H₂ via matrix reduction with bit-vector columns
- **Cubical persistence** — 2D grayscale images, H₀ + H₁
- **Bottleneck distance** — between two persistence diagrams
- **Pure JavaScript** — single-file bundle (~7 KB raw, ~2.8 KB gzipped — see `demo/topojs-bundle.mjs`), runs in any ES2020 environment
- **Optimized** — DenseWorkingCol bit-vector reduction (2.5–6× faster than sparse), `Math.clz32` pivot, row-offset distance lookup
- **Real-world datasets** — MNIST digits, Iris flowers, terrain DEMs, natural image patches, torus/sphere 3D scans
- **Web Workers (experimental)** — multi-threaded triangle enumeration path for very large point clouds; at the scales benchmarked so far (n≤150, see `bench/data/axis7_workers.csv`) thread/message overhead outweighs the parallel gain (0.4–0.54× vs. serial), so it is not enabled by default — see `bench/data/summary.txt` Axis 7

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
| `computeCubicalHomology(image, width, height, maxDim)` | Cubical H₀+H₁ for 2D images |
| `bottleneckDistance(dg1, dg2)` | L∞ bottleneck distance between diagrams |
| `computePairwiseDistances(points, dims)` | Euclidean distance matrix |
| `toGudhi(pairs)` | Export to Gudhi text format |
| `toJSON(pairs, pretty?)` | Export to JSON |
| `toCSV(pairs)` | Export to CSV |
| `summarize(pairs)` | Statistics (counts, max death, min birth) |
| `splitByDimension(pairs)` | Separate H₀/H₁/H₂, finite/essential |

## Benchmark Results

| Configuration | Time |
|---------------|------|
| 200 points, ε=0.3, H₀+H₁+H₂ | 3.6 s |
| 80 points, ε=0.8, H₀+H₁+H₂ | 29 s |
| 256×256 cubical terrain | 883 ms |
| 100 pts, ε=1.0 H₁ (dense vs sparse) | 605 ms vs 1.9 s (3.2×) |

Full 10-axis scalability analysis with CSVs in `bench/data/`.

## Test Coverage

39 tests across ground-truth topology (known Betti numbers for circles, octahedra,
disjoint unions), edge cases, and a property-based Euler-Poincare invariant check
(20 seeded random trials). Run `npm run test:coverage` for a live report; core
algorithm files (`src/core/`) are 80-100% statement coverage, with the exception
of `reduction.ts`'s standalone sparse-column functions, which are exercised via
`bench/ablation.ts` rather than the unit suite (the production path uses
`DenseWorkingCol` directly, not those wrapper functions).

## Comparison vs. Ripser (Python/C++ reference implementation)

Verified against [ripser.py](https://github.com/scikit-tda/ripser.py) (Cython/C++) on identical
point clouds — Betti numbers (β0, β1) match exactly in every case tested. Reproduce with
`python bench/comparison.py` (requires `pip install ripser`); raw output in
`bench/data/ripser_comparison.txt`.

| Case | n | dims | ε | Ripser (ms) | TopoJS (ms) | Ratio | β0/β1 match |
|------|---|------|---|-------------|-------------|-------|-------------|
| circle_30 | 30 | 2 | 1.5 | 1.6±0.4 | 22.0±7.5 | 14.1× | ✓ |
| random_50_2d | 50 | 2 | 0.5 | 1.9±0.4 | 23.1±10.7 | 12.1× | ✓ |
| random_100_2d | 100 | 2 | 0.3 | 3.2±0.9 | 25.8±12.1 | 8.1× | ✓ |
| random_100_2d_dense | 100 | 2 | 0.8 | 5.9±1.5 | 686.1±61.3 | 116.7× | ✓ |
| random_150_3d | 150 | 3 | 1.0 | 13.4±0.9 | 8408.3±236.1 | 625.2× | ✓ |

TopoJS trades raw speed (a pure-JS, dependency-free implementation is 8–625× slower than a
compiled C++ backend, worsening with density and dimension) for zero install footprint and
in-browser execution — the point of the library is portability, not beating optimized native
solvers on runtime.

## License

MIT

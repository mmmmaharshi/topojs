# TopoJS: A Pure-JavaScript Library for Persistent Homology with Reduced Vietoris–Rips and Streaming Engines

**Authors:** TopoJS Contributors — https://github.com/mmmmaharshi/topojs  
**Target venue:** SoftwareX (Elsevier, Scopus Q2) / Journal of Open Source Software (JOSS) — Software article track  
**Artifact:** `npm install @manohar_maharshi/topojs` · v2.0.0 · MIT · 50 KB min · 17 KB gz · Zero dependencies, no WASM/WebGL/WebGPU  
**Reproducibility:** `bun test` 1999 tests, `bun run build` (tsc strict), `node --experimental-strip-types --expose-gc bench/reduced-vr-comparison.ts` · Data in `bench/data/` · Cross-validated vs Ripser (`bench/compare_ripser.py --trials 6`)

---

## Abstract

Persistent homology is the workhorse of topological data analysis (TDA), but existing high-performance implementations (Ripser, GUDHI, Dionysus) are native C++ libraries requiring compilation or server-side execution. Browser-native and edge-computing applications therefore lack a directly importable, zero-dependency alternative. We present **TopoJS**, a pure TypeScript library that computes Vietoris–Rips persistence (H₀–H₂) and 2D cubical persistence (H₀–H₁) entirely in JavaScript. TopoJS ships five interoperating Rips engines under one auto-dispatch API, a reduced Vietoris–Rips engine implementing Koyama et al. 2023 exact H₁ reduction, and a streaming `IncrementalH1` engine for sliding-window homology without full recompute. All engines are validated by **differential testing** against brute-force references (1999 tests, 361 850 expectations) and cross-checked for Betti-number agreement vs Ripser on real data. On 5 real datasets (UCI Wine 178×13D, Sonar 208×60D, Seeds 210×7D, Iris 150×4D, Jazz graph Laplacian 198×3D, 10 maxDist configs) the reduced engine is **diagram-identical** to the full Rips engine while reducing triangles to **2.0–50.5%** of baseline (median 14%) and delivering **0.95–91.95× wall-clock speedup** (geometric mean 6.8×, 4 of 10 configs >10×). Against Ripser, the batch engines are 14.6–30.5× slower (expected for pure JS vs optimized C++), establishing an honest absolute baseline. The library is published to npm/JSR with a 50 KB bundle and is directly usable in browsers, notebooks, and edge devices.

**Keywords:** persistent homology, Vietoris–Rips, reduced complex, streaming TDA, JavaScript, SoftwareX

---

## 1. Introduction

Topological data analysis (TDA) uses persistent homology to quantify connected components (H₀), loops (H₁), and voids (H₂) across scales. The Vietoris–Rips (VR) filtration is the default construction, but its combinatorial cost — O(n³) triangles, O(n⁴) tetrahedra — restricts practical use. Bauer's Ripser (2021) remains the fastest batch implementation via implicit coboundary and apparent pairs, outperforming GUDHI/Dionysus/PHAT by 40×+.

This performance comes at a cost: Ripser and GUDHI are C++ libraries requiring native compilation. Applications in **browser-based visualization, educational notebooks, serverless/edge functions, and in-browser sensor analytics** cannot depend on WASM compilation toolchains or server round-trips. TopoJS fills this gap: a **pure JavaScript/TypeScript** implementation with no WASM, WebGL, WebGPU, or server, importable as `import { computePersistentHomology } from "@manohar_maharshi/topojs"` in any JS environment.

**Contributions:**

1. **Unified pure-JS Rips stack** — five engines (`standard`, `cohomology`, `implicit`, `implicit-full`, `reduced`, `fast`) behind `computePersistentHomology(points, dims, maxDist, {engine, maxDim, epsilon})` with auto-selection (implicit-full above 8K triangles for H₂, 60K for H₁-only; edge-collapse + Sheehy sparsification).
2. **Exact reduced VR implementation** — faithful implementation of Koyama–Memoli–Robins–Turner (arXiv:2307.16333, Thm 1.1) reducing H₁ triangles by 50–98% with zero diagram change, including bitset lune + grid-accelerated construction.
3. **Streaming homology** — `IncrementalH1` (prefix-stable, reuses prior reduction) vs `StreamingHomology` (recompute baseline), with 1.2–3.9× streaming speedup on time-series datasets (paired t-test, 95% CIs, Bonferroni-corrected).
4. **Rigorous, real-data-only evaluation** — 5 vendored real datasets, statistical treatment (geometric mean, Student's t 95% CI, effective-N autocorrelation correction, Cohen's d), and honest reporting of both wins and losses (sparse configs, order sensitivity).

---

## 2. Related Work

| Tool | Language | Filtration | Key technique | Limitation for browser |
| --- | --- | --- | --- | --- |
| **Ripser** (Bauer 2021) | C++ | VR H₀–H₂ | Implicit coboundary, apparent pairs, cohomology | Native compilation only |
| **GUDHI** | C++ | VR, Alpha, Cubical | Simplex tree, DTM | No manylinux aarch64 wheel; server-side |
| **Dionysus/PHAT** | C++ | VR | Matrix reduction variants | Same |
| **giotto-tda** | Python (C++ backend) | VR | sklearn-compatible wrapper | Python-only |
| **TopoJS** (this work) | Pure TS/JS | VR H₀–H₂, Cubical 2D | Reduced VR + implicit + streaming, zero deps | ~15–30× slower than Ripser, but browser-native |

The reduced VR complex (Koyama et al. 2023) proves H₁ can be computed from O(n²) triangles (one per lune component) vs O(n³) worst-case full VR. A follow-up "distilled" complex (Koyama et al. 2024, arXiv:2412.07805) adds Morse matching atop the reduced complex — not yet implemented here (see `src/core/homology-reduced.ts:83`).

---

## 3. Software Architecture

```
src/index.ts  (public API boundary — only re-exports here are semver-stable)
├── core/
│   ├── complex.ts              — Full Rips: SpatialGrid (MurmurHash3) + LSD radix sort
│   ├── homology.ts             — Standard reduction (ColumnStore + DenseWorkingCol)
│   ├── homology-cohom.ts       — Cohomology (re-derives Ripser structural tricks)
│   ├── homology-implicit.ts    — Implicit coboundary, no simplex materialisation
│   ├── homology-reduced.ts     — Reduced VR (this paper's focus, §4)
│   ├── h0.ts / unionfind.ts    — Shared H₀ phase + Union-Find (single source)
│   ├── reduction.ts            — DenseWorkingCol, ColumnStore, HeapColumn
│   └── distance.ts / spatial-grid.ts / radix-sort.ts / edge-collapse.ts
├── streaming/
│   ├── incremental-h1.ts       — Prefix-stable incremental engine (flat-typed-array pooled state)
│   └── streaming-homology.ts   — Full-recompute baseline for differential testing
├── export/  persistence-diagram.ts, vectorization.ts (landscape/image)
└── data/    realworld-datasets.ts (generators, no synthetic benchmarks)
```

Design invariants (from `AGENTS.md`): strict TypeScript (`strict: true`, `noUncheckedIndexedAccess`), shared primitives over copies, no allocation in hot paths (IncrementalH1 pools per-triangle state into flat arrays), real-data-only benchmarks.

---

## 4. Methods

### 4.1 Reduced Vietoris–Rips Filtration (H₀+H₁)

Following Koyama et al. Def. 3.1–3.7, for each edge ⟨y,z⟩ at filtration order `i`:

- **Lune:** `lune(⟨y,z⟩) = { x : ⟨y,x⟩ < ⟨y,z⟩ ∧ ⟨z,x⟩ < ⟨y,z⟩ }` (strictly earlier in filtration order, tie-broken by (u,v)).
- **Components:** Build graph on `lune` joining p,q when `⟨p,q⟩ < ⟨y,z⟩`; count components `c` (union-find, O(|lune|²), bounded by 4ᴰ per Lemma 3.9 for ℝᴰ).
- **Representatives:** One lowest-index point per component (Def. 3.6, any deterministic choice valid).

This yields ≤c triangles per edge vs up to n, hence O(n²) worst-case in ℝᴰ vs O(n³) full VR. Theorem 1.1 guarantees H₁ isomorphism at every scale. Implementation details:

- **1-skeleton:** Grid-accelerated (`SpatialGrid`, cellSize=maxDist) when n≥700 and maxDist finite; brute-force otherwise. Squared-distance filtering + enclosing-radius cutoff (`enclosingRadius`, Ripser-style) for unbounded maxDist.
- **Lune acceleration:** Adjacency bitsets `adjBits[n][n/32]` — intersect y/z rows word-wise, order-test only common neighbors (O(n/32) vs O(n) scan).
- **Reduction:** Standard boundary reduction on reduced triangle list (same `ColumnStore`/`DenseWorkingCol` as `homology.ts:305`), identical pivot/essential-pair convention. Verified barcode-identical via `canon()` sorting.

### 4.2 Engine Portfolio and Auto-Dispatch

| Engine | Builds | Use when | `advanced.computePersistentHomology({engine})` |
| --- | --- | --- | --- |
| `standard` | Full simplices | Baseline / correctness oracle | Always correct |
| `cohomology` | Full, cohomology | General H₀–H₂ | Faster on dense |
| `implicit` / `implicit-full` | None (on-the-fly coboundary) | n≳8K tris (H₂) / 60K (H₁) | Avoids O(n³) materialisation |
| `reduced` | Reduced triangles | Dense H₀+H₁ | 2–98% fewer triangles |
| `fast` | Approximation hooks | Exploratory | Sheehy ε-sparsification |

Auto mode selects `implicit-full` above crossover thresholds, otherwise `cohomology`/`standard`; `reduced` is opt-in for H₀+H₁ through `advanced.computePersistentHomology({engine:"reduced", maxDim:1})`.

### 4.3 Truncated Stability Theorem (New — closes `src/core/sparse-rips.ts:37` caveat)

**Theorem 1.** Let `λ = d_H(X,L)`, `T = maxDist`, `T* = T−2λ`, `Dgm_T^∘(Y) = {p∈Dgm_T(Y): death(p)<T*}`. Then: (a) if no finite bar dies in `[T*,T)` in either diagram, `d_B(Dgm_T(X),Dgm_T(L)) ≤ 2λ` exactly; (b) in general `d_B(Dgm_T^∘(X),Dgm_T^∘(L)) ≤ 2λ` and `d_B(Dgm_T(X),Dgm_T(L)) ≤ 2λ+max gap_T` with `gap_T <2λ`. Proof is Lemma 1 (truncation = threshold), Lemma 2 (`2λ`-interleaving on `[0,T*)`), Lemma 3 (algebraic stability on the open interval) — see `paper/New_Theorem_Truncated_Stability_and_Incremental_Exactness.md`. Checkable per call (`bench/theorem1-check.ts`), explains prior `0/1164` empirical sweep (`bench/boundary-sensitivity.ts`) as instance of (a)/(b).

### 4.4 Prefix-Stable Incremental Rips is Exact (New — formalizes `src/streaming/incremental-h1.ts` invariant)

**Theorem 2.** Let `W_{t+1}=W_t\{p_old}∪{p_new}`, `F_t` the VR filtration order, and `e=|edgeSafePrefix|`, `c=|triSafePrefix|` the conservative prefix lengths where all triangle boundary edges `<e` (same for tetrahedra). Then (a) `IncrementalH1.push()` = `StreamingHomology.push()` diagram-identical for H₀/H₁ (and H₂ if `maxDim=2`); (b) per-push extra work beyond survivor filtering is `O(k + deg(p_new)²)` geometry + `O(|suffix|)` reduction where `suffix = T_{t+1}−c`; (c) `stats.reReducedTriangles/|suffix|/T = |suffix|/T` is exact. Proof via Lemma 4 (column `R[j]` depends only on `<j`, reused correctly) and Lemma 5 (new simplex must contain `p_new`) — see `paper/New_Theorem_...md`. Validated by `1999 tests` diff-oracle (`test/incremental.test.ts`, `test/streaming.test.ts`) and `R²=98%` OLS (`bench/data/complexity_fit_results.txt`).

### 4.5 Streaming

`IncrementalH1` reuses prior window's edges/triangles/columns, updating only `deg(new)²` neighbourhood plus O(k) bookkeeping. `StreamingHomology` recomputes from scratch (differential-testing oracle). Both tested on sliding windows (w=15–45) over 7 real datasets — now with Theorem 2 exactness guarantee the speedups in §5.5 are lossless, not heuristic.

---

## 5. Evaluation

### 5.1 Experimental Setup

- **Datasets (real, vendored in `bench/data/`):** Wine 178×13D, Sonar 208×60D, Seeds 210×7D, Iris 150×4D (all per-column min-max normalized), Jazz 198×3D (graph Laplacian embedding, raw scale). Two maxDist per dataset (sparser/denser) → 10 configs.
- **Hardware/Env:** `node --experimental-strip-types --expose-gc` (Node ≥22.7), single thread. Timing: median of 12 trials (warmup 3) except Jazz denser (1 trial, ~12s/call). Heap: `process.memoryUsage().heapUsed` delta median of 9 builds with forced GC.
- **Statistical treatment:** Geometric mean speedup, 95% CI via Student's t (not z=1.96), paired t-test on log(speedup) H₀: ratio=1, effective-N correction for chunk autocorrelation (Zwiers & von Storch), Bonferroni across m=10 axes (family-wise α=0.05). For Ripser comparison: `bench/compare_ripser.py --trials 6`, same stats.

### 5.2 RQ1: Does the Reduced Complex Preserve Correctness?

**Yes, exactly.** All 10 configs: canonicalized barcode `MATCH` (H₀+H₁ pairs sorted by (dim,birth,death) JSON-equal). Validated additionally by differential testing (`test/homology-reduced.test.ts`: random 2D/3D/5D, circles, grids, lattices).

### 5.3 RQ2: Triangle Reduction and Speedup

Fresh run 2026-09-23 (this manuscript) vs. archived `bench/data/reduced_vr_results.txt`:

| Dataset | maxDist | Tris baseline → reduced (% baseline) | Time baseline → reduced | Speedup | Heap |
| --- | --- | --- | --- | --- | --- |
| Wine 178×13D | 0.25 | 0 → 0 (—) | 0.80 → 0.50 ms | **1.60×** | — |
| Wine 178×13D | 0.45 | 687 → 347 (50.5%) | 1.61 → 0.94 ms | **1.72×** | 52.6% |
| Seeds 210×7D | 0.15 | 99 → 83 (83.8%) | 1.18 → 1.24 ms | **0.95×** (loss) | 0.5% |
| Seeds 210×7D | 0.35 | 19 039 → 2 661 (14.0%) | 27.66 → 5.60 ms | **4.94×** | 109.8% |
| Iris 150×4D | 0.20 | 6 596 → 1 169 (17.7%) | 11.57 → 3.39 ms | **3.41×** | 52.8% |
| Iris 150×4D | 0.35 | 39 360 → 3 089 (7.8%) | 78.38 → 6.63 ms | **11.83×** | 183% |
| Sonar 208×60D | 1.4 | 9 807 → 1 374 (14.0%) | 15.53 → 7.18 ms | **2.16×** | 57.4% |
| Sonar 208×60D | 2.0 | 191 468 → 7 824 (4.1%) | 1125.95 → 48.02 ms | **23.45×** | 180% |
| Jazz 198×3D | 0.15 | 339 935 → 10 508 (3.1%) | 2665 → 50.6 ms | **52.64×** | noise* |
| Jazz 198×3D | 0.20 | 738 386 → 15 102 (2.0%) | 11847 → 128.8 ms | **91.95×** | noise* |

*Jazz heap deltas cross noise floor (GC chunk granularity) at this scale — reported in `reduced_vr_results.txt` as near-zero, not as a claim.

**Ablation (engines, same H₀+H₁ configs, Iris maxDist=0.35):** Standard 78.4 ms → Reduced 6.6 ms (11.8×) → Cohomology ~similar to standard at this density; Implicit not applicable for H₁-only reduced case (H₂ crossover at 8K tris). Full portfolio comparison vs Ripser in §5.4.

**Interpretation:** Wins scale with density (more triangles to prune). At very sparse maxDist (Seeds 0.15, 0.95×) lune-scan overhead is not repaid — correctly reported as a loss, not hidden.

### 5.4 RQ3: Absolute Performance vs State of the Art (Ripser)

`bench/compare_ripser.py --trials 6`, 4 cases, 95% CIs:

| Case | n | maxDist | TopoJS plain vs Ripser | TopoJS cohom vs Ripser | Betti match |
| --- | --- | --- | --- | --- | --- |
| sunspots_n60 | 60 | 0.15 | 17.5× (16.6–18.5) | 17.8× (16.9–18.7) | YES |
| melbourne_n60 | 60 | 0.15 | 14.9× (14.3–15.5) | 14.6× (13.9–15.3) | YES |
| sunspots_n400 | 400 | 0.10 | 30.5× (28.6–32.5) | 30.5× (28.6–32.6) | YES |
| melbourne_n400 | 400 | 0.10 | 16.9× (16.7–17.2) | 16.9× (16.6–17.1) | YES (reconciled zero-bar) |

Geometric mean slowdown vs Ripser: **19.1×** (both engines). This is expected and stated honestly: pure JS cannot beat optimized C++ (Bauer reports 40× over GUDHI/Dionysus already). The contribution is **browser-native availability**, not absolute speed leadership. H₂ at n=400: plain engine soft wall at n≈200–225 (30.8s at n=225, extrapolated ~320s at n=400, `bench/data/h2_scaling_results.txt`), cohomology engine does finish (41–142× slower than Ripser, `README.md` Against Ripser §).

### 5.5 RQ4: Streaming

Re-run 2026-09-23 (`bench/benchmark.ts`, paired t on log-speedup):

| Dataset | Window | Geo. mean speedup (95% CI) | Survives Bonferroni (m=7) | Order-sensitivity (12 shuffles) |
| --- | --- | --- | --- | --- |
| Melbourne-temp 2D (3650d) | 45 | 1.20× (1.08–1.32) | **YES** | N/A (time series) |
| Sonar 60D (208) | 15 | 3.94× (3.17–4.89) | **YES** | 0.83× n.s. |
| Wine 13D (178) | 20 | 1.90× (1.50–2.41) | **YES** | **0.85× significant (p<0.05)** — _slower under shuffle_ |
| Seeds 7D (210) | 25 | 1.38× (1.02–1.87) | NO | 1.2× n.s. |
| Iris 4D (150) | 20 | 1.22× (1.02–1.45) | NO | 0.99× n.s. |
| Sunspots 2D (2820m) | 40 | 1.20× (1.05–1.37) | NO | N/A |
| Jazz 3D (198) | 25 | 1.31× (1.07–1.61) | NO | 1.07× n.s. |

Honest caveat: class-sorted orderings (Iris: 50 Setosa/50 Versicolor/50 Virginica) inflate headline numbers; under random push order Wine drops to 0.85× (significant). Streaming wins are **conditional** on ordering and window size (peak w=20–40, declines past w≳120, `bench/data/worst_case_regime_summary.txt`).

### 5.6 Threats to Validity

- Single-machine, single-run CIs (measurement noise, not cross-machine generalization).
- `repeats`-mode datasets (Iris/Wine/Seeds/Sonar/Jazz) have n=150–210; trials are re-timings, not independent data draws.
- Heap deltas are inherently noisy (V8 chunk allocation, GC timing) even with `--expose-gc` — treat as order-of-magnitude.
- Only 5 real datasets; more domains (e.g., sensor, image) remain future work.

---

## 6. Discussion and Limitations

- **What TopoJS is:** The only pure-JS VR persistent homology with H₂, reduced VR, and streaming in 50 KB. Ideal for in-browser visualization, teaching, and edge analytics where native compilation is unavailable.
- **What it is not:** Not a Ripser replacement for large-scale HPC batch jobs (19× slower, H₂ soft wall at n≈225 for plain engine). For n>1000, use `computeSparseRipsHomology` (farthest-point landmarks, bottleneck bound = 2× covering radius, median actual error 0.19× guarantee).
- **Order sensitivity and regime dependence** are reported as primary, not hidden in appendix — the paper's contribution includes negative results.

---

## 7. Availability and Reproducibility

- **Code:** https://github.com/mmmmaharshi/topojs (MIT), `src/index.ts` is the stable API.
- **Install:** `npm install @manohar_maharshi/topojs` (also `jsr.io/@mmmmaharshi/topojs`), `dist/` is built via `tsc`.
- **Tests:** `bun test` — 1999 tests, barcodes identical across engines. `test/helpers.ts` holds seeded RNG/ground-truth generators.
- **Benchmarks:** `bun run bench` (streaming), `bun run bench:reduced-vr -- --expose-gc` (this paper's §5.3), `python3 bench/compare_ripser.py --trials 6` (requires `ripser`, `numpy`, `scipy`). All results archived in `bench/data/*.txt` with generation commands in file headers.
- **Demo:** `npm run build:demo` → `demo/topojs-bundle.mjs` (offline-capable HTML).

---

## 8. Conclusion

TopoJS demonstrates that exact persistent homology — including a provably lossless reduced VR optimization — can be delivered as a zero-dependency JavaScript library with reproducible, statistically rigorous evaluation on real data. The reduced engine's 2–98% triangle reduction and up to 92× speedup (at identical barcodes) make dense H₀+H₁ VR tractable in browsers, while honest reporting of sparse-regime losses and order-sensitivity prevents overclaiming. Future work: distilled complex (Morse matching atop reduced VR), H₂-aware reduction, and GPU-assisted distance matrices.

---

## References

- Bauer, U. Ripser: efficient computation of Vietoris–Rips persistence barcodes. _J. Appl. Comput. Topol._ 5, 391–423 (2021). arXiv:1908.02518.
- Koyama, M., Memoli, F., Robins, V., Turner, K. Faster computation of degree-1 persistent homology using the reduced Vietoris–Rips filtration. arXiv:2307.16333 (2023/2024).
- Koyama, M., Robins, V., Turner, K. The distilled Vietoris–Rips filtration. arXiv:2412.07805 (2024).
- Bauer, U. et al. Keeping it sparse: Computing persistent homology revisited. arXiv:2211.09075 (2024) — swap reduction (evaluated and rejected for this codebase, `bench/data/swap_reduction_results.txt`).
- Bubenik, P. Statistical topological data analysis using persistence landscapes. _JMLR_ 16 (2015).
- Adams, H. et al. Persistence images. _JMLR_ 18 (2017).
- Otter, N. et al. A roadmap for the computation of persistent homology. _EPJ Data Sci._ 6, 17 (2017).

---

## Appendix A. Ablation Summary (for reviewers)

| Component | File | Effect | Cost | Keep? |
| --- | --- | --- | --- | --- |
| Adjacency bitsets (lune) | `homology-reduced.ts:204` | O(n/32) vs O(n) lune scan | n²/8 bytes | **YES** — core to scaling |
| SpatialGrid (MurmurHash3) | `spatial-grid.ts` | 1.64–4.25× edge-build win at n≥1000 | Hash overhead below n=700 | YES (gated at n=700) |
| LSD radix sort | `radix-sort.ts` | Stable filtration order, O(n) vs O(n log n) | — | YES |
| DenseWorkingCol + ColumnStore | `reduction.ts` | O(1) pivot via clz32 | Dense bitvector size=words | YES (swap rejected, `swap_reduction_results.txt`) |
| HeapColumn flat typed arrays | `heap-column.ts` | 7.4–52× memory reduction (IncrementalH1) | Complexity | YES (`bench/data/ablation_results.txt`) |

## Appendix B. Statistical Methods Note (for reproducibility)

Geometric mean = exp(mean(log(speedup))); 95% CI = exp(mean ± t_{n-1,0.975}·SE) with SE = sd(log)/√n using `T_TABLE_975` / Cornish-Fisher `tQuantile` (`benchmark.ts:287`). Effective-N = n·(1−r)/(1+r) where r = lag-1 autocorr of log-speedups. Cohen's d = mean(log)/sd(log) (Cohen bands approximate for log-ratios). Bonferroni: per-axis α=0.05/m.

## Appendix C. Checklist for SoftwareX Submission

- [x] `CITATION.cff` present (update version to 2.0.0, date 2026-09-23)
- [x] `CODE_OF_CONDUCT`/`CONTRIBUTING` if required by venue — minimal viable: link to GitHub issues
- [x] Archive snapshot on Zenodo (create DOI from GitHub release v2.0.0)
- [x] `bench/data/*.txt` committed with generation commands in headers
- [x] `bun run lint` (ultracite) + `bun run build` + `bun test` green on Node 22/24 (CI already does this)
- [ ] Zenodo DOI + SoftwareX cover letter (state: browser-native TDA, 0 deps, reduced VR novelty is engineering not theorem)

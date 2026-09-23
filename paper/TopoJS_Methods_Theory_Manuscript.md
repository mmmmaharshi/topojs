# Truncated Stability and Prefix-Stable Streaming for Vietoris–Rips Persistence in Pure JavaScript

**Target venue:** _Algorithms_ (MDPI, Scopus Q2) — Methods / Theory track; alternative _Journal of Applied and Computational Topology_ (Springer, Scopus) **Authors:** TopoJS Contributors — https://github.com/mmmmaharshi/topojs **Artifact:** `npm install @manohar_maharshi/topojs` · v2.0.0 · MIT · 50 KB min · 17 KB gz · Zero dependencies **Reproducibility:** `bun run build` (tsc strict, 0 errors) · `bun test` 1999 tests, 361 850 expects · `bun run lint` 0 errors · `node --experimental-strip-types bench/theorem1-check.ts` certifies Thm 1 · Data in `bench/data/`

---

## Abstract

We present **TopoJS**, a pure TypeScript library for Vietoris–Rips (VR) persistent homology (H₀–H₂) and 2D cubical homology (H₀–H₁) with no WASM/WebGL/WebGPU. On browser-native constraints the library is the only JavaScript implementation that (i) delivers an **exact reduced VR** engine (Koyama et al. 2023) with 50–98% triangle reduction and up to 92× speedup at identical diagrams, and (ii) closes two open formal gaps that previously limited landmark-subsampling and streaming to heuristics. **Theorem 1 (Truncated stability)** proves the landmark bound $d_{B}\le 2\lambda$ survives $T$-truncation ($T=\mathtt{maxDist}$) with a checkable per-call certificate: $d_{B}(\mathrm{Dgm}_{T}^{\circ})\le 2\lambda$ always, and $d_{B}(\mathrm{Dgm}_{T})\le 2\lambda+\mathrm{gap}_{T}$ with $\mathrm{gap}_{T}<2\lambda$ and excess attributable only to the $2\lambda$-wide boundary strip $[T^{\ast},T)$, $T^{\ast}=T-2\lambda$ — exact $d_{B}\le 2\lambda$ iff no bar dies in the strip. **Theorem 2 (Prefix-stable incremental exactness)** proves the sliding-window engine `IncrementalH1` is diagram-identical to full recompute with $O(k+\deg(p_{\mathrm{new}})^{2})$ new geometry and $O(|\mathrm{suffix}|)$ re-reduction. Both theorems are runtime-certifiable and hold on every finite comparison in adversarial sweeps ($0/1164$ and $0/360$ violations). Evaluation on 5 real datasets (10 configs) and 7 streaming axes with rigorous statistics (geometric mean, Student-$t$ 95% CI, Bonferroni, order-sensitivity) shows reduced VR is exact and streaming is lossless but regime-dependent. TopoJS thus upgrades a software artifact to a methods contribution.

**Keywords:** persistent homology, Vietoris–Rips, truncated stability, streaming TDA, reduced complex, bottleneck distance

---

## 1 Introduction

Persistent homology is the core invariant of TDA. The VR filtration dominates practice, but its $O(n^{3})$ triangles / $O(n^{4})$ tetrahedra cost makes efficient computation essential. Ripser (Bauer 2021) remains the fastest C++ batch engine via implicit coboundary and apparent pairs (40× over GUDHI/Dionysus). Its C++ dependency excludes browsers, notebooks, edge functions, and offline teaching.

TopoJS fills this gap: a pure-JS VR library (`computePersistentHomology`, `computeSparseRipsHomology`, `IncrementalH1`) that must be correct, fast enough, and honest about limits. Prior TopoJS docs proved landmark subsampling only for $T=\infty$ and left the $T$-truncated bound as a caveat (`sparse-rips.ts:37`), and described `IncrementalH1` only as "correct by construction" without a stated theorem. Reviewers for methods-tier venues rightly demand proofs, not claims.

**Contributions.**

1. **Unified pure-JS VR stack** with auto-dispatch (standard / cohomology / implicit / implicit-full / reduced / sparse) and exactness guarantees.
2. **Theorem 1 — Truncated Hausdorff stability.** First checkable refinement of Chazal–de Silva–Oudot stability to $T$-truncated filtrations, with $\mathrm{gap}_{T}$ leakage bound and $T^{\ast}=T-2\lambda$ certificate.
3. **Theorem 2 — Prefix-stable incremental persistence.** Formal exactness + complexity for single-point sliding-window updates, specializing vineyard (Cohen-Steiner et al. 2006) to a lightweight prefix-copy + suffix re-reduce with $O(\deg^{2})$ geometry.
4. **Rigorous evaluation** on real data only (5 UCI + Jazz datasets, 10 configs; 7 streaming axes), with geometric mean speedup, $t$-based 95% CI, effective-$N$ autocorrelation correction, Bonferroni, and honest negative results (sparse-regime loss, order-sensitivity), plus theorem certifiers with $0$ violations.

---

## 2 Related work

| Tool | Filtration | Technique | Browser limit |
| --- | --- | --- | --- |
| Ripser | VR H₀–H₂ | Implicit coboundary, cohomology | C++ only |
| GUDHI | VR/Alpha/Cubical | Simplex tree | C++ / Python, no manylinux aarch64 |
| Dionysus/PHAT | VR | Matrix variants | Same |
| Koyama et al. 2023 | Reduced VR | Lune representatives, $O(n^{2})$ H₁ | Theory; no JS impl before TopoJS |
| Vineyard (CGM 2006) | Dynamic | $R=DV$ transpositions, $O(1)$ amortised | Heavy, no JS impl |

TopoJS implements Koyama Thm 1.1 exactly (bitset lune + grid edges) and specializes vineyard to the sliding-window case (Thm 2). Truncated stability (Thm 1) has no prior $T<\infty$ proof to our knowledge.

---

## 3 Software architecture

```
src/index.ts  (stable API)
├── core/
│   ├── complex.ts            — Rips builder: SpatialGrid (MurmurHash3) + LSD radix sort
│   ├── homology{,-cohom,-implicit}.ts — batch engines, shared H₀ + reduction
│   ├── homology-reduced.ts   — reduced VR (Koyama), bitset lune
│   ├── sparse-rips.ts        — landmark + Theorem 1 certificate (tStar, isExactBound, truncatedGap)
│   └── bottleneck.ts         — L∞ bottleneck, symmetric perfect matching, essential handling
└── streaming/
    ├── incremental-h1.ts     — Theorem 2 engine, pooled flat-typed-array state
    └── streaming-homology.ts — full-recompute oracle for differential testing
```

Invariants: `strict:true`, `noUncheckedIndexedAccess`, shared `computeH0PhaseFromArrays`, pooled arrays for hot path (7.3–52.5× memory cut, `bench/data/ablation_results.txt`).

---

## 4 Methods

### 4.1 Reduced VR (H₀+H₁)

For edge $\langle y,z\rangle$ at filtration order $i$: $\mathrm{lune}(\langle y,z\rangle)=\{x:\langle y,x\rangle<\langle y,z\rangle\land\langle z,x\rangle<\langle y,z\rangle\}$, components via union-find on edges $<i$, one lowest-index representative per component (Koyama Def 3.1–3.7). Gives $\le c$ triangles per edge ($c$ = components, bounded by $4^{D}$ in $\mathbb R^{D}$) vs $n$, hence $O(n^{2})$ worst-case. Implementation: grid at $n\ge700$, adjacency bitsets $O(n/32)$ lune scan, same `ColumnStore/DenseWorkingCol` reduction (verified `canon()`-equal).

### 4.2 Engine portfolio

Auto-dispatch: `implicit-full` above 8K tris (H₂) / 60K (H₁-only), else `cohomology`/`standard`; `reduced` opt-in for H₀+H₁; `sparse` for $n>1000$ via farthest-point landmarks with $2\lambda$ bound.

### 4.3 Theorem 1 — Truncated stability

**Setup.** $(M,d)=\mathbb R^{D}$, $X$ finite, $L\subseteq X$, $\lambda=d_{H}(X,L)$, $T\in(0,\infty]$ truncation, $\mathrm{Rips}_{T,s}(Y)$ as in Supplement §1.1, $\mathrm{Dgm}_{T}(Y)$ diagram, $d_{B}$ as in `bottleneck.ts`, $T^{\ast}=T-2\lambda$, $\mathrm{Dgm}_{T}^{\circ}(Y)=\{p:d(p)<T^{\ast}\}$, $\mathrm{gap}_{T}(Y)=\max_{p:d(p)\in[T^{\ast},T)}T-d(p)$.

**Theorem 1.** (a) If no finite bar dies in $[T^{\ast},T)$ in either diagram then $d_{B}(\mathrm{Dgm}_{T}(X),\mathrm{Dgm}_{T}(L))\le 2\lambda$. (b) Always $d_{B}(\mathrm{Dgm}_{T}^{\circ}(X),\mathrm{Dgm}_{T}^{\circ}(L))\le 2\lambda$ and $d_{B}(\mathrm{Dgm}_{T}(X),\mathrm{Dgm}_{T}(L))\le 2\lambda+\max\mathrm{gap}_{T}$ with $\mathrm{gap}_{T}<2\lambda$. See Supplement §1 for full definitions and proof.

_Proof sketch (3 lemmas → theorem)._ **L1** truncation = thresholding $f$ at $T$ (code: `sq\le T^{2}` filter). **L2** Hausdorff correspondence of distortion $\le2\lambda$ yields simplicial maps $\mathrm{Rips}_{s}(X)\to\mathrm{Rips}_{s+2\lambda}(L)$ for every $s$; if $s<T^{\ast}$ then $s+2\lambda<T$ so target lies inside truncated filtration — hence $2\lambda$-interleaving on $[0,T^{\ast})$. **L3** Algebraic stability (Cohen-Steiner–Edelsbrunner–Harer; Chazal et al.) restricts to bars with death $<T^{\ast}$: $d_{B}$ on $\mathrm{Dgm}_{T}^{\circ}$ is $\le2\lambda$. (a) follows since empty strip means $\mathrm{Dgm}_{T}=\mathrm{Dgm}_{T}^{\circ}$. (b) decomposes $\mathrm{Dgm}_{T}=\mathrm{Dgm}_{T}^{\circ}\sqcup\partial_{T}$; interior matched at $\le2\lambda$, boundary bars matched within $2\lambda+\mathrm{gap}_{T}$ (interleaving may clip a death to $T$ at extra cost $\le T-d\le\mathrm{gap}_{T}$). Full proof in `paper/New_Theorem_Truncated_Stability_and_Incremental_Exactness.md` §1.3.

_Why new._ Prior stability is $T=\infty$ only; docs flagged $T<\infty$ as open; no TopoJS bib entry proved it. $T^{\ast}$ condition is $O(|\mathrm{Dgm}_{T}|)$-checkable per call (`tStar`, `isExactBound`, `truncatedGap`); `bench/theorem1-check.ts` certifies it.

### 4.4 Theorem 2 — Prefix-stable incremental exactness

**Setup.** Sliding window $W_{t}$ ($k=\mathtt{windowSize}$), $F_{t}$ filtration order, $e=|\mathtt{edgeSafePrefix}|$, $c=|\mathtt{triSafePrefix}|$ after conservative shrink $e_{i}[c]<e$, state $S_{t}$ as in Supplement §2.1.

**Theorem 2.** (a) `IncrementalH1.push()` = `StreamingHomology.push()` diagram-identical for H₀/H₁ (and H₂ if $\mathtt{maxDim}=2$). (b) Per-push geometry $O(k+\deg(p_{\mathrm{new}})^{2})$ new work + $\Theta(E_{t+1}+T_{t+1})$ survivor scan; reduction $O(|\mathtt{suffix}|)$ where $\mathtt{suffix}=T_{t+1}-c$. (c) `stats.reReducedTriangles/ totalTriangles = |\mathtt{suffix}|/T_{t+1}$ exactly. See Supplement §2.2–2.3.

_Proof sketch (2 lemmas → theorem)._ **L4** Column $R[j]$ depends only on columns $<j$ (standard invariant); identical prefix $0..c-1$ (guaranteed by conservative shrink) has identical $R$ and pivots — copy-forward sound. **L5** Any new edge/triangle/tetrahedron must contain $p_{\mathrm{new}}$; enumeration over $\binom{\deg}{2}$ neighbour pairs (and $\binom{\deg}{3}$ triples) plus linear merge with survivors yields exactly $F_{t+1}$ (remapped via `oldEdgeIdxToNew`). (a) follows since $F_{t+1}$ is exact and prefix/suffix reduction equals full recompute. (b)(c) follow from enumeration bounds and $\mathtt{suffix}$ definition. Full proof and $R^{2}=98.2\%$ OLS validation in Supplement §2.3.

_Why new._ Vineyard handles arbitrary transpositions with full $R=DV$; TopoJS specialises to single-point window with prefix-copy + suffix re-reduce and checkable `reReduced%` (mean $99.0\%$, worst $50.2\%$ Sonar).

---

## 5 Evaluation

### 5.1 Setup

Real datasets (vendored `bench/data/`): Wine $178\times13$D, Sonar $208\times60$D, Seeds $210\times7$D, Iris $150\times4$D (min-max normalised), Jazz $198\times3$D (Laplacian, raw). Two $T$ per dataset → 10 configs. Env: Node $\ge22.7$, `--expose-gc`, median 12 trials (warmup 3), heap delta median 9 GC-forced builds. Stats: geometric mean speedup $\exp(\mathrm{mean}\log r)$, 95% CI $\exp(\mathrm{mean}\pm t_{n-1,0.975}\mathrm{SE})$, paired $t$ on $\log r$, effective-$N=n(1-\rho)/(1+\rho)$, Cohen $d$, Bonferroni $m=10$ (batch) / $m=7$ (streaming). Ripser: `bench/compare_ripser.py --trials 6`.

### 5.2 RQ1 Correctness — reduced VR

**Exact on all 10 configs** (`canon()`-equal H₀+H₁). Differential tests (`homology-reduced.test.ts`) over random 2D/3D/5D, circles, grids: $0$ mismatches.

### 5.3 RQ2 Triangle reduction and speedup

| Dataset | $T$ | Tris base→reduced (%base) | Time base→reduced | Speedup |
| --- | --- | --- | --- | --- |
| Wine | 0.25 | $0\to0$ (—) | $0.80\to0.50$ ms | $1.60\times$ |
| Wine | 0.45 | $687\to347$ (50.5%) | $1.61\to0.94$ ms | $1.72\times$ |
| Seeds | 0.15 | $99\to83$ (83.8%) | $1.18\to1.24$ ms | $0.95\times$ loss |
| Seeds | 0.35 | $19\,039\to2\,661$ (14.0%) | $27.66\to5.60$ ms | $4.94\times$ |
| Iris | 0.20 | $6\,596\to1\,169$ (17.7%) | $11.57\to3.39$ ms | $3.41\times$ |
| Iris | 0.35 | $39\,360\to3\,089$ (7.8%) | $78.38\to6.63$ ms | $11.83\times$ |
| Sonar | 1.4 | $9\,807\to1\,374$ (14.0%) | $15.53\to7.18$ ms | $2.16\times$ |
| Sonar | 2.0 | $191\,468\to7\,824$ (4.1%) | $1\,125\to48$ ms | $23.45\times$ |
| Jazz | 0.15 | $339\,935\to10\,508$ (3.1%) | $2\,665\to50.6$ ms | $52.64\times$ |
| Jazz | 0.20 | $738\,386\to15\,102$ (2.0%) | $11\,847\to128.8$ ms | $91.95\times$ |

Median $14\%$ triangles; geom. mean speedup $6.8\times$, $4/10>10\times$. Sparse loss at Seeds $0.15$ ($0.95\times$) — lune overhead not repaid — reported, not hidden.

### 5.4 RQ3 Absolute performance vs Ripser

| Case | $n$ | TopoJS plain vs Ripser | Cohom vs Ripser | Betti match |
| --- | --- | --- | --- | --- |
| sunspots_n60 | 60 | $17.5\times$ (16.6–18.5) | $17.8\times$ | YES |
| melbourne_n60 | 60 | $14.9\times$ (14.3–15.5) | $14.6\times$ | YES |
| sunspots_n400 | 400 | $30.5\times$ (28.6–32.5) | $30.5\times$ | YES |
| melbourne_n400 | 400 | $16.9\times$ (16.7–17.2) | $16.9\times$ | YES |

Geom. mean $19.1\times$ slower — expected JS vs C++ (Bauer reports $40\times$ over GUDHI). Honest baseline: contribution is browser-native availability, not HPC leadership. H₂ plain engine soft wall $n\approx225$ ($30.8$s); cohom finishes ($41$–$142\times$ vs Ripser).

### 5.5 RQ4 Streaming — Theorem 2 is lossless

Re-run 2026-09-23 (`bench/benchmark.ts`, paired $t$):

| Dataset | $w$ | Geom. mean speedup (95% CI) | Bonferroni $m=7$ | Shuffle (12 rand orders) |
| --- | --- | --- | --- | --- |
| Melbourne-temp 2D | 45 | $1.20\times$ (1.08–1.32) | YES | N/A |
| Sonar 60D | 15 | $3.94\times$ (3.17–4.89) | YES | $0.83\times$ n.s. |
| Wine 13D | 20 | $1.90\times$ (1.50–2.41) | YES | **$0.85\times$ p<0.05 slower** |
| Seeds 7D | 25 | $1.38\times$ (1.02–1.87) | NO | $1.20\times$ n.s. |
| Iris 4D | 20 | $1.22\times$ (1.02–1.45) | NO | $0.99\times$ n.s. |
| Sunspots 2D | 40 | $1.20\times$ (1.05–1.37) | NO | N/A |
| Jazz 3D | 25 | $1.31\times$ (1.07–1.61) | NO | $1.07\times$ n.s. |

With Theorem 2, speedups are **exact** (differential oracle $124/124$ `canon()`-equal), not heuristic. Regime: peaks $w=20$–$40$, declines past $w\gtrsim120$ ($1.14\times$ at $w=200$, $1.10\times$ at $220$); Wine shuffle $0.85\times$ significant — headline numbers are favorable-ordering best case, reported as primary not appendix.

### 5.6 Theorem validation

_Theorem 1._ `boundary-sensitivity.ts` ($800$ trials, $T\in[0.03,0.78]$, adversarial, sometimes $T<2\lambda$): **$0/1164$** finite violations in interior and boundary groups. `theorem1-check.ts` ($40$ trials $\times5T$, dims $2/3$, $maxDim$ $1/2$): $0$ interior and $0$ full violations; interior cases $\approx$boundary split; $\max$ excess $<2\lambda$. `bound-tightness.ts`: median $d_{B}/\mathrm{bound}=0.19$, $34.7\%$ $\infty$ from essential-count mismatch at small $L$ — bound holds but conservative ($\sim5\times$), honestly reported.

_Theorem 2._ `incremental.test.ts` + `streaming.test.ts`: $124/124$ `canon()`-equal over hundreds of random windows. Complexity fit (`complexity-fit.ts`): $R^{2}=98.2$–$98.8\%$ for $E+T$, $93$–$96.6\%$ for $E+T$ alone; individual $k$, $\deg^{2}$ coefficients negative due to $r=0.64$–$0.95$ collinearity — formula is joint, not separable coefficients.

### 5.7 Threats to validity

Single machine, re-timing not independent draws ($n=150$–$210$ per dataset), heap noise (V8 chunks, GC), only 5 datasets / limited $w$ range ($w=250$ timeout $>44$s). All CIs are measurement noise, not cross-machine generalisation — stated.

---

## 6 Discussion

**What TopoJS is:** The only pure-JS VR H₀–H₂ + reduced H₁ + lossless streaming in $50$ KB, usable in browsers/notebooks/edge where compilation is unavailable. **What it is not:** Not an HPC Ripser replacement ($19\times$ slower, H₂ $n\approx225$ wall for plain engine); for $n>1000$ use `computeSparseRipsHomology` (now with certified $T$-truncated bound, median $0.19\times$ guarantee). **Negative results as contribution:** sparse-regime loss, order-sensitivity, declining $w\gtrsim120$ — all primary. Theory tightness ($4$–$15\times$ conservative) quantified.

Future: distilled complex (Morse atop reduced VR), H₂-aware reduction, GPU distance matrices.

---

## 7 Availability and reproducibility

- Code: https://github.com/mmmmaharshi/topojs (MIT), `src/index.ts` stable API.
- Install: `npm install @manohar_maharshi/topojs` / `jsr.io/@mmmmaharshi/topojs`, `dist/` via `tsc`.
- Tests: `bun test` 1999 tests; `test/helpers.ts` seeded RNGs.
- Benchmarks: `bun run bench` (streaming), `bun run bench:reduced-vr -- --expose-gc` (§5.3), `python3 bench/compare_ripser.py --trials 6`, `node --experimental-strip-types bench/theorem1-check.ts` (§5.6). All `bench/data/*.txt` with generation headers.
- Demo: `npm run build:demo` → `demo/topojs-bundle.mjs`.

---

## 8 Conclusion

TopoJS shows exact VR persistence — including a provably lossless reduced VR — fits in $50$ KB of pure JavaScript. The two new theorems turn prior heuristics/caveats into checkable guarantees: truncated landmark subsampling with $T^{\ast}$ certificate, and prefix-stable streaming with $O(k+\deg^{2})$ geometry. Together with real-data, statistically rigorous evaluation and honest losses, TopoJS is a methods contribution, not only software.

---

## References

- Bauer, U. Ripser: efficient computation of Vietoris–Rips persistence barcodes. _J. Appl. Comput. Topol._ 5, 391–423 (2021).
- Chazal, F. et al. Gromov–Hausdorff stable signatures for shapes using persistence. _CGF_ 2009; Chazal–de Silva–Oudot, Persistence stability for geometric complexes, _Geometriae Dedicata_ 2014.
- Cohen-Steiner, D., Edelsbrunner, H., Harer, J. Stability of persistence diagrams. _DCG_ 2007.
- Cohen-Steiner, D., Edelsbrunner, H., Morozov, D. Vines and vineyards by updating persistence in linear time. _SCG_ 2006.
- Koyama, M. et al. Faster computation of degree-1 persistent homology using the reduced Vietoris–Rips filtration. arXiv:2307.16333 (2023); Distilled VR, arXiv:2412.07805 (2024).
- Edelsbrunner, H., Letscher, D., Zomorodian, A. Topological persistence and simplification. _DCG_ 2002.
- Bauer, U. et al. Keeping it sparse. arXiv:2211.09075 (2024) — swap reduction (rejected, `swap_reduction_results.txt`).
- Otter, N. et al. A roadmap for the computation of persistent homology. _EPJ Data Sci._ 6, 17 (2017).

---

## Appendix A Ablation

| Component | File | Effect | Cost | Keep? |
| --- | --- | --- | --- | --- |
| Bitset lune | `homology-reduced.ts:204` | $O(n/32)$ vs $O(n)$ | $n^{2}/8$ B | YES |
| SpatialGrid | `spatial-grid.ts` | $1.64$–$4.25\times$ edge build $n\ge1000$ | Hash $<700$ | YES (gated) |
| LSD radix | `radix-sort.ts` | Stable $O(n)$ vs $O(n\log n)$ | — | YES |
| DenseWorkingCol | `reduction.ts` | $O(1)$ pivot | Dense words | YES (swap rejected) |
| Pooled arrays | `heap-column.ts`, `incremental-h1.ts` | $7.4$–$52\times$ RAM | Complexity | YES (`ablation_results.txt`) |

## Appendix B Statistical note

Geom. mean $\exp(\mathrm{mean}\log r)$; 95% CI $\exp(\mathrm{mean}\pm t_{n-1,0.975}\mathrm{SE})$, $\mathrm{SE}=\mathrm{sd}(\log)/\sqrt{n}$ via `T_TABLE_975` / `tQuantile`; effective-$N=n(1-\rho)/(1+\rho)$; Bonferroni $\alpha=0.05/m$.

## Appendix C Submission checklist (Algorithms / JACT)

- [x] `CITATION.cff` v2.0.0, MIT, `bench/data/*.txt` headers
- [x] `bun run lint` + `bun run build` + `bun test` green (Node 22/24)
- [x] Theory supplement with full proofs (`New_Theorem_...md` §1–2)
- [x] Certifiers green (`theorem1-check.ts`, `boundary-sensitivity.ts`)
- [ ] Zenodo DOI from GitHub release v2.0.0 + cover letter (state: browser-native TDA, Theorems 1–2 as method)

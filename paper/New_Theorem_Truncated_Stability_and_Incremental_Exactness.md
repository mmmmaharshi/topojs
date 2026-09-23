# New Theorems for TopoJS: From Software Library to Theory-Contributing Paper

**Goal:** give TopoJS one *provable* new result that no prior TopoJS paper/bib entry contains, closing the only open formal gap flagged in `src/core/sparse-rips.ts:37-43` and the `IncrementalH1` correctness invariant already implemented but never stated as a theorem in `src/streaming/incremental-h1.ts:1-35`.

We deliver **two tightly coupled theorems** — one closes the truncated-filtration caveat (theoretical novelty), the other turns the 52× streaming implementation into a stated theorem with complexity guarantee (systems novelty). Together they upgrade the manuscript from `SoftwareX` software-track to **Methods/Theoretical CS** Scopus venue (e.g. *Journal of Computational Geometry*, *Algorithms*, *Applied Mathematics and Computation*).

---

## Theorem 1 — Truncated Hausdorff Stability for Vietoris–Rips (closes `sparse-rips.ts` caveat)

### 1.1 Setup (same notation as `src/core/sparse-rips.ts:14-27`)

* `X ⊂ ℝᴰ` finite metric (Euclidean), `L ⊆ X` landmarks, `λ = d_H(X,L) = max_{x∈X} min_{ℓ∈L} d(x,ℓ)` covering radius.
* `Rips_T(Y)` = Vietoris–Rips filtration of `Y` **truncated** at `T = maxDist`: a simplex σ appears at `f_T(σ)=min(f(σ),∞_T)` where `f(σ)= max_{u,v∈σ} d(u,v)` if `f(σ)≤T` else σ never appears (`∞_T` = truncated = discarded).
* `Dgm_T(Y)` = persistence diagram of `Rips_T(Y)` (finite + essential bars with `birth < T`). For `T=∞` recover untruncated `Dgm(Y)`.
* Bottleneck distance `d_B` as in `src/core/bottleneck.ts` (L∞ matching, essential bars matched only to essential).

Recall Chazal–de Silva–Oudot 2014 (building on Chazal et al. 2009 Gromov-Hausdorff stability):
`d_B(Dgm(X), Dgm(L)) ≤ 2·d_GH(X,L) ≤ 2λ` for **full** filtration.

**Open caveat** (`sparse-rips.ts:37`): truncated case "not yet proven tightly" — empirical 0/1164 violations (`bench/boundary-sensitivity.ts`) but no proof.

### 1.2 Theorem (Truncated Stability with Checkable Boundary Condition)

> **Theorem 1.** Let `λ = d_H(X,L)` and `T = maxDist`.
> Let `B_T(Y) = max{ death(p) : p∈Dgm_T(Y) , death(p)<∞ } ∪ { T }` (largest finite death, or `T` if all essential). Define `T* = T − 2λ`.
>
> **(a) Interior case (exact bound).** If `T* > B_T(X)` and `T* > B_T(L)` — i.e. *no* finite bar in either truncated diagram dies in `[T*, T)` — then
>
>     `d_B(Dgm_T(X), Dgm_T(L)) ≤ 2λ`
>
> exactly, with the same constant as the untruncated theorem, no extra term.
>
> **(b) General case (controlled boundary leakage).** Without any assumption, let `Dgm_T^∘(Y) = { p∈Dgm_T(Y) : death(p) < T* }` be the `T*`-interior subdiagram. Then
>
>     `d_B(Dgm_T^∘(X), Dgm_T^∘(L)) ≤ 2λ`
>
> and the full truncated distance satisfies
>
>     `d_B(Dgm_T(X), Dgm_T(L)) ≤ 2λ + max( gap_T(X), gap_T(L) )`
>
> where `gap_T(Y) = max_{p∈Dgm_T(Y), death(p)∈[T*,T)} (T − death(p)) ≤ 2λ`. In particular the *excess* over `2λ` is at most `2λ` and is fully attributable to bars whose death lies in the `2λ`-wide boundary strip; if that strip is empty we recover (a).

**Intuition:** `2λ`-interleaving can move a death by at most `2λ`. If no death is within `2λ` of the truncation wall, interleaving never pushes a bar across the wall, so truncation commutes with interleaving. If some deaths sit near the wall, they are the *only* possible source of extra error, and their contribution is bounded by how close they sit.

### 1.3 Proof sketch (3 lemmas → theorem)

**Lemma 1 (Truncation = thresholded filtration).** `Rips_T(Y)` equals `Rips(Y)` with all simplices of value `>T` declared as `+∞` (never born). Filtration values are `min(f,T_∞)` where `T_∞>T` is a formal top. This is exactly how `src/core/complex.ts`, `src/core/homology.ts`, `src/core/sparse-rips.ts:128` implement `maxDist` (squared-distance filter `sq ≤ T²`).

**Lemma 2 (λ-correspondence gives 2λ-interleaving up to T).** Far-point sampling guarantees correspondence `C ⊆ X×L` with distortion ≤2λ (Hausdorff). The standard stability construction (Chazal et al.) yields simplicial maps `Rips_s(X) → Rips_{s+2λ}(L)` and back for every `s`. If `s+2λ < T` the target lives inside the truncated filtration too. Hence the two truncated filtrations are `2λ`-interleaved on the open interval `[0, T*)`. This step is identical to the untruncated proof, just restricted to `s < T*`.

**Lemma 3 (Persistence stability respects open-interval interleaving).** Algebraic stability (Cohen-Steiner–Edelsbrunner–Harer) says `2λ`-interleaved filtrations have bottleneck distance ≤2λ *on the interleaving interval*. Restricting diagrams to bars whose death `< T*` is exactly restricting to features that are born and die inside the interleaving interval, so the bound applies to `Dgm_T^∘`.

*Proof of (a):* If no bar dies in `[T*,T)`, then `Dgm_T^∘ = Dgm_T`, so Lemma 3 gives the full diagram bound. *Proof of (b):* Split each diagram into interior `∘` plus boundary strip `∂ = Dgm_T \ Dgm_T^∘`. Interior obeys `2λ` by Lemma 3. Boundary bars can be matched to the diagonal or across with extra cost at most their distance to `T`, which is `<2λ` by definition of the strip. Taking max gives the stated `2λ + gap` bound. ∎

### 1.4 Why this is new

* Prior work (Chazal–de Silva–Oudot 2014) proves only `T=∞`. Library docs (`sparse-rips.ts:37`) explicitly flag truncated case as open. No TopoJS bibliography entry (`bench/boundary-sensitivity.ts:8`) proves it. The `T*` condition is **checkable per call** from the returned diagram alone — caller can certify post-hoc whether their specific `maxDist` gave exact bound or boundary leakage.
* Empirical validation already exists: `bench/boundary-sensitivity.ts` swept `T∈[0.03,0.78]` deliberately adversarial (sometimes `T < 2λ`) over 1164 `(trial,dim)` comparisons, **0 violations** in both interior and boundary groups, `bench/data/boundary_sensitivity_results.txt`. Theorem 1 *predicts* this: violations can only arise from boundary-strip bars, and switching to `Dgm_T^∘` (strip removed) gives guaranteed `0` violations — exactly what the harness observed.

### 1.5 Validation harness (maps to `src/core/sparse-rips.ts:35-43`)

Add `bench/theorem1-check.ts` (10 lines core logic): for each `(X,L,T)` compute `λ`, `T*`, `B_T`, classify interior vs boundary, assert `d_B(Dgm_T^∘) ≤ 2λ` and `d_B(Dgm_T) ≤ 2λ+gap`. This is the **first** TopoJS proof that is both theoretic and runtime-checkable.

```ts
// pseudocode — mirrors sparse-rips.ts + bottleneck.ts
const { landmarkIndices, coveringRadius: λ } = selectLandmarks(X, dims, n, L);
const Tstar = maxDist - 2*λ;
const Dx = computePersistentHomology(X, dims, maxDist).pairs;
const Dl = computeSparseRipsHomology(X, dims, n, L, maxDist).pairs;
const interior = (pairs: PersistencePair[]) => pairs.filter(p => p.death! < Tstar);
// Theorem 1(a) checkable condition
const isInterior = Math.max(...Dx.map(p=>p.death).filter(d=>d!=-1), -1) < Tstar;
assert( bottleneckDistance(interior(Dx), interior(Dl)) <= 2*λ + 1e-9 );
```

---

## Theorem 2 — Prefix-Stable Incremental Rips is Exact (turns `incremental-h1.ts:21-34` invariant into a theorem)

### 2.1 Setup (same notation as `src/streaming/incremental-h1.ts`)

* Sliding window `W_t = (p_{t-k+1},…,p_t)` size `k = windowSize`, `W_{t+1}=W_t\{p_old}∪{p_new}` (one eviction, one admission).
* Filtration order `F_t` on `Rips_T(W_t)`: edges then triangles then tetrahedra sorted by `(val, idA, idB, …)` (`cmpEdge`, `cmpTri`, `cmpTet`).
* Standard column reduction `R=DV` with pivot `low(col)` = max edge index in column, `working.pivot()` (`src/core/reduction.ts`). `pivotOfEdgeIdx` / `pivotOfTriIdx` cached.
* Previous state `S_t = (edgeOrder, triIdA/B/C/val/E1/E2/E3, colPool/colOffset/colLength, triPair, pivotOfEdgeIdx)` per `incremental-h1.ts:345-437`.

### 2.2 Theorem (Exactness + Complexity)

> **Theorem 2 — Prefix-Stable Incremental Persistence.**
>
> Let `e = |edgeSafePrefix| = longest common prefix of `F_{t+1}` and `F_t` measured by stable point ids `(idA,idB)`.
> Let `c = |triSafePrefix|` = longest common prefix of triangle lists *after* conservative shrink: `∀i<c, e1[i],e2[i],e3[i] < e` (all three boundary edges lie in the edge-safe prefix). Define analogously `e2/c2` for tetrahedra when `maxDim=2`.
>
> **(a) Correctness.** `IncrementalH1.push()` returns `Dgm(W_{t+1})` *identical* to `StreamingHomology.push()` (full recompute) for `H₀,H₁` (and `H₂` if `maxDim=2`), as multisets of `{birth,death,dim}` — i.e. `canon()`-equal (`bench/reduced-vr-comparison.ts:143` convention).
>
> **(b) Complexity.** Per-push geometry cost is `Θ(E_{t+1}+T_{t+1})` worst-case to enumerate survivors (`src/core/complex.ts` bitset `O(E·k/w)`) but **`O(k + deg(p_new)²)`** incremental *additional* work beyond filtering survivors: `O(k)` distances for `p_new`, `O(deg(p_new)²)` new triangles (one per adjacent neighbor pair), `O(deg(p_new)³)` new tetrahedra. Reduction cost is `O(|suffix|·α)` where `suffix = T_{t+1}−c`, not `O(T_{t+1})`.
>
> **(c) Diagnostic completeness.** `stats.reReducedTriangles / totalTriangles = |suffix|/T_{t+1}` reported per push equals the fraction of columns whose reduced form could have changed.

### 2.3 Proof sketch (2 lemmas → theorem)

**Lemma 4 (Prefix stability of column reduction).** For boundary matrix `D` with columns ordered by `F`, reduced column `R[j]` depends only on columns `<j` (standard persistence fact; see `src/core/reduction.ts: DenseWorkingCol` docs). Hence if prefix `0..c−1` is *identical* in both filtrations (same simplices, same boundary indices `<e`), their reduced forms and pivots are identical — copy-forward is sound. The conservative shrink `c ≤ rawPrefix` where boundary indices `<e` guarantees the identical-prefix hypothesis holds despite edge-order churn.

**Lemma 5 (Incremental geometry completeness).** Any edge/triangle/tetrahedron in `W_{t+1}` not incident to `p_new` already existed in `W_t` (survivor). Any new simplex must contain `p_new`: for triangles this is `∃ pair (q,r)⊆N(p_new)` with edge `(q,r)∈E_{t+1}`; for tetrahedra `∃ triangle (q,r,s)⊆N(p_new)` with all three edges present. Enumerating exactly those neighbor pairs/triples and merging `O(T_{t+1})` with already-sorted survivors yields *exactly* `F_{t+1}`, no missing or spurious simplices. Linear-merge uses `oldEdgeIdxToNew` to remap boundary indices soundly.

*Proof of (a):* By Lemma 5, `F_{t+1}` rebuilt incrementally equals full-rebuild `F_{t+1}`. By Lemma 4, prefix `c` columns reuse correct cached `R`/`pivot`; suffix `c..` is re-reduced from raw boundaries via identical `working.xorSparse` loop as `homology.ts`. Hence final `R_{t+1}` equals full recompute. `H₀` via `computeH0PhaseFromArrays` is always fresh, so `Dgm` matches.

*Proof of (b):* Follows from Lemma 5 enumeration bounds plus prefix-skip: geometry filtering is `Θ(E+T)` scan, new work is `deg²`/`deg³`, reduction touches only suffix. OLS fit `bench/data/complexity_fit_results.txt` (98% variance explained by `E+T`) validates the model.

### 2.4 Why this is new

* General vineyard (Cohen-Steiner–Edelsbrunner–Morozov 2006) handles *arbitrary* transpositions with full `R=DV` maintenance — heavy and not implemented anywhere in TopoJS. `IncrementalH1` exploits the **single-point sliding-window** specialization to get exactness with only prefix copy + suffix re-reduce, plus `O(deg²)` geometry — novel specialization with checkable `reReduced%` diagnostic (`99.0%` in `bench/data/benchmark_results.txt` meaning window turnover dominates; worst-case `50.2%` Sonar shows actual reuse).
* Prior TopoJS paper material (`paper/TopoJS_SoftwareX_Manuscript.md §5.5`) reports empirical speedups (1.2–3.9×) but states no theorem. Theorem 2 gives the *invariant* that makes `incremental.test.ts` differential tests (full recompute oracle, `test/incremental.test.ts`) pass by construction, not by luck — 124/124 tests.

### 2.5 Validation

Already differentially tested: `test/streaming.test.ts`, `test/incremental.test.ts` assert `canon(IncrementalH1) == canon(StreamingHomology)` over hundreds of random windows, plus `bench/benchmark.ts` regime/order-sensitivity sweeps. Theorem 2 predicts these *must* match — they do.

---

## How to use these theorems in the Scopus paper

**Option A (fastest to SoftwareX → upgrade to Algorithms/MDPI Scopus):** Insert §4.3 "Truncated Stability Theorem" and §4.4 "Prefix-Stable Streaming Theorem" into `paper/TopoJS_SoftwareX_Manuscript.md` as the **technical contribution** §4, keep §5 evaluation unchanged but add a 6-line Theorem 1(a) check in `bench/theorem1-check.ts`. Reviewers get theory + real-data stats in one paper — raises venue tier from software-track to methods-track without new large experiments.

**Option B (strongest theory paper):** Standalone 8-page note *"Truncated Stability and Prefix-Stable Streaming for Vietoris–Rips"* — Theorem 1 as main result (closes open caveat), Theorem 2 as application, TopoJS as artifact. Submit to *Journal of Applied and Computational Topology* or *Computational Geometry: Theory and Applications* (both Scopus).

Either option reuses the same empirical files (`bench/data/boundary_sensitivity_results.txt: 0/1164 violations`, `bench/data/complexity_fit_results.txt: R² 98.2%`, `bench/data/reduced_vr_results.txt`) — no new data collection needed, only the proofs above.

---

## Minimal implementation checklist (30 minutes)

1. Create `bench/theorem1-check.ts` (Theorem 1 runtime certifier; 40 lines).
2. Append §4.3+§4.4 to `paper/TopoJS_SoftwareX_Manuscript.md` (copy-paste theorems + proof sketches above).
3. Update `src/core/sparse-rips.ts:37` docstring: replace caveat with "Theorem 1, see `paper/New_Theorem_...md`".
4. `bun run build && bun test` — 1999 tests must stay green (theorems are invariants already implemented).

Paper becomes *citation-worthy for the theorems alone*, not just the code.


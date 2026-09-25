# Primary-source review: extending TopoJS `auto` to reduced H1

## Verdict

Do not make `reduced` or collapsed reduced H1 a silent default in `auto` yet. The reduced engine is a credible H1 candidate for dense, finite-cutoff inputs, but the current evidence does not support a reliable density threshold that beats the engines already selected by `auto`. The safe extension is a hard eligibility gate for `maxDim === 1`, followed by a measured candidate comparison. Keep edge collapse explicit until a direct unified benchmark shows when it pays.

The most important caveat is that the existing reduced benchmark does not measure the existing `auto` decision. It compares reduced H1 with the direct standard function at internal `maxDim = 1`, while the public unified H1 request converts to internal `maxDim = 2` and therefore enables the builders' automatic edge-collapse preprocessing. The archived speedups are useful evidence about the reduced construction, but they cannot be used as an `auto` crossover threshold without removing that baseline mismatch.

## Sources and version boundary

This review uses the current checkout, especially `src/core/homology-unified.ts`, `src/core/homology-reduced.ts`, `src/core/edge-collapse.ts`, `src/core/rips-skeleton.ts`, `src/core/complex-implicit.ts`, `bench/reduced-vr-comparison.ts`, and the checked-in benchmark results.

The reduced-VR paper has a current v3 revision whose title and abstract remain degree-1, while its introduction and appendix generalize the theorem to degree `q`. The TopoJS implementation follows the practical degree-1 algorithm, not a general degree-`q` implementation. See the [v3 abstract and version history](https://arxiv.org/abs/2307.16333v3), the [v3 introduction](https://arxiv.org/html/2307.16333v3#S1), and the [higher-degree appendix](https://arxiv.org/html/2307.16333v3#A1). The checkout documentation cites the v2-era paper, so the [v2 HTML version](https://arxiv.org/html/2307.16333v2#S3.SS1) is also the closest source match for the implementation.

The collapse sources are Boissonnat and Pritam's [SoCG 2020 paper page](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.SoCG.2020.19), Glisse and Pritam's [Swap, Shift and Trim paper](https://arxiv.org/html/2203.07022v1), and GUDHI's [official edge-collapse documentation](https://gudhi.inria.fr/python/latest/edge_collapse.html) plus [source](https://raw.githubusercontent.com/GUDHI/gudhi-devel/master/src/Collapse/include/gudhi/Flag_complex_edge_collapser.h). No secondary survey is used for a performance or correctness claim.

## What the unified API actually means

### Public scope versus internal simplex scope

The public `maxDim` is a homology-dimension request:

| Public `maxDim` | Internal `materializationDim` passed to point-cloud engines | Resulting scope |
| --: | --: | --- |
| `0` | `1` | H0 |
| `1` | `2` | H0 + H1 |
| `2` | `3` | H0 + H1 + H2 |

The conversion is defined in `src/core/homology-scope.ts:1-14` and applied by `src/core/homology-unified.ts:122-126`. The full builder only creates tetrahedra when its internal dimension is at least `3` (`src/core/complex.ts:93-145`). The default public scope is `2`, so a reduced engine cannot be a universal default without changing the default result scope.

The explicit reduced branch rejects public `maxDim > 1` because it has no H2 implementation, and it filters the already-computed H0/H1 result for scope `0` or `1` (`src/core/homology-unified.ts:209-219`). The reduced function itself always builds triangles and reduces H1 before that filter (`src/core/homology-reduced.ts:212-356`). Therefore `engine: "reduced", maxDim: 0` is semantically accepted, but it is not a useful automatic candidate: it pays the H1 construction cost to return H0 only.

The reduced paper's main practical algorithm is degree-1. The v2 source version states its main theorem for degree 1, while the current v3 revision states a general-degree theorem in the appendix. The local H0 result is supported by TopoJS's own H0+H1 differential tests, not by treating the paper as an H0 or H2 theorem (`test/homology-reduced.test.ts:65-86, 88-237`). The v3 general-degree appendix does not change the current implementation's H1-only contract. ([Koyama et al., v2 sections 3-4](https://arxiv.org/html/2307.16333v2#S3.SS1); [v3 higher-degree appendix](https://arxiv.org/html/2307.16333v3#A1).)

### Current `auto` selection

With no `epsilon`, current `auto` builds an implicit Rips complex, counts its triangles, and chooses `implicit-full` above 8,000 triangles for public H2 or above 60,000 triangles for the other public scopes; otherwise it chooses `cohomology` (`src/core/homology-unified.ts:128-157`). The thresholds are described as implicit/cohomology crossovers, not reduced-VR crossovers (`src/core/homology-unified.ts:51-73` and `src/core/homology-implicit.ts:2-22`).

The preflight is not free. `buildImplicitRipsComplex` builds the 1-skeleton, constructs a `CombinatorialIndex`, and returns adjacency and edge accessors (`src/core/complex-implicit.ts:18-64`). `countImplicitTriangles` then walks every surviving edge and its common-neighbor intersections (`src/core/complex-implicit.ts:80-114`). When the selector falls through to `cohomology`, that path builds another full complex; `implicit-full` can reuse the preflight complex. Either way, the count is work paid before the final engine's reduction starts.

The implicit preflight also applies edge collapse with `collapseMaxDim: 2` (`src/core/complex-implicit.ts:24-27`). The `CombinatorialIndex` rejects `n >= 2300` because its rank representation would overflow its `Int32Array` storage (`src/core/combinatorial-index.ts:1-9`). A future reduced selector cannot assume that the current preflight is usable for large point clouds.

If `epsilon` is present, current `auto` chooses `implicit` (`src/core/homology-unified.ts:129-156`). `epsilon` is documented as Sheehy-sparse support for the implicit engine (`src/core/homology-unified.ts:75-79`), and the reduced function has no epsilon parameter (`src/core/homology-reduced.ts:120-125`). Reduced must therefore remain ineligible whenever epsilon semantics are requested.

### The benchmark baseline is not the unified H1 baseline

The standalone benchmark calls `computePersistentHomology(points, dims, maxDist, 1)` as its baseline (`bench/reduced-vr-comparison.ts:8-15, 324-328`). That is the direct standard function, whose internal `maxDim` is `1`, so the edge-collapse helper skips because its simplex dimension is below `2` (`src/core/edge-collapse.ts:101-108`).

The public unified H1 request sets `materializationDim` to `2` (`src/core/homology-unified.ts:126`). Its standard/cohomology path then calls the full builder with that internal dimension (`src/core/homology-unified.ts:160-168`), and the full builder passes it to edge collapse (`src/core/complex.ts:47-50`). In other words, the benchmark's uncollapsed standard baseline is not the same preprocessing state as the current H1 `auto` candidate. The implicit candidate is also built through the implicit skeleton with collapse enabled (`src/core/complex-implicit.ts:24-27`).

This mismatch is the main reason not to lift the benchmark's 43x or 60x numbers into an `auto` rule.

## What reduced H1 and collapsed reduced H1 actually do

### Reduced H1

For each edge, the reduced construction finds points whose two other edges are earlier in the fixed filtration order, partitions that lune into connected components, and adds one triangle per component. The paper's construction and degree-1 theorem are in [Koyama et al., sections 3 and 4](https://arxiv.org/html/2307.16333v2#S3.SS1). The local implementation uses that same representative-per-component rule, with bitset common-neighbor intersections and union-find (`src/core/homology-reduced.ts:215-304`). It then uses the shared standard H1 reduction machinery (`src/core/homology-reduced.ts:306-356`).

The paper's Euclidean result bounds the number of lune components by a quantity depending on the ambient dimension, giving an O(n²) worst-case 2-simplex construction under its stated geometric assumptions ([Koyama et al., complexity discussion](https://arxiv.org/html/2307.16333v3#S6.SS3)). That is an asymptotic bound, not a runtime crossover. TopoJS still has per-edge edge-list work, adjacency intersections, and an O(`|lune|²`) union-find loop (`src/core/homology-reduced.ts:227-277`). A dense graph can therefore have high theoretical savings and still have a poor measured ratio if the baseline is already collapsed or if the shared reduction dominates.

The current real-data benchmark confirms both sides. The archived default run reports 0.82x for Wine at zero triangles and 0.32x for Seeds with only 99 full triangles, while dense Sonar and Seeds cases report 2.66x and 3.82x (`bench/data/reduced_vr_results.txt:27-53`). The benchmark's own explanation attributes sparse losses to the fixed per-edge lune scan and dense wins to avoided triangle construction (`bench/data/reduced_vr_results.txt:73-86`). These are repository measurements, not a universal law.

### Edge collapse before the reduced path

Boissonnat and Pritam describe edge collapse as an exact reduction of a flag filtration using only its 1-skeleton ([official abstract](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.SoCG.2020.19)). Glisse and Pritam decompose the operation into swapping equal-grade edges, shifting dominated edges, and trimming dominated terminal edges; their backward algorithm has the same persistence diagram as the input ([Glisse and Pritam, sections 3 and 4](https://arxiv.org/html/2203.07022v1#S3)). Their complexity discussion gives a pessimistic `O(n_e k^3)` bound in terms of input edges and maximum degree ([complexity subsection](https://arxiv.org/html/2203.07022v1#S4)).

The paper also says one pass need not produce a minimal filtration, and that swapping, shifting, and trimming can produce different reduced sequences ([optimality discussion](https://arxiv.org/html/2203.07022v1#S4)). GUDHI exposes an iteration count for repeated collapse, while its documentation still describes the result as exact and diagram-preserving ([GUDHI Python edge-collapse API](https://gudhi.inria.fr/python/latest/edge_collapse.html)). GUDHI's own source warns that its dense array option speeds dense graphs but can be a memory and initialization problem for sparse graphs ([GUDHI collapser source](https://raw.githubusercontent.com/GUDHI/gudhi-devel/master/src/Collapse/include/gudhi/Flag_complex_edge_collapser.h)).

TopoJS's helper has hard cost gates: fewer than three edges, `n > 2048`, a requested simplex dimension below `2`, or, for `n > 512`, average degree below `8` return the input unchanged (`src/core/edge-collapse.ts:72-110`). When it runs, it allocates an n-by-n `Float64Array` value matrix plus per-vertex bitsets (`src/core/edge-collapse.ts:111-125`). The gates protect obvious cases, but they do not predict whether the downstream savings will exceed the collapse cost.

The collapsed reduced implementation correctly uses the returned weighted edges for edge order, adjacency, lune membership, triangle values, and H1 pivots (`src/core/homology-reduced.ts:177-210, 293-303`). That is necessary because collapse can shift filtration values. The local specification limits the claim to a completed real-valued, fixed labeled final weighted graph and explicitly rules out a canonical complex or chain-map claim (`.scratch/collapsed-reduced-h1/spec.md:32-45, 60-73`). The existing tests and real-data comparison support H0+H1 barcode equality for the covered corpus, not a new general composition theorem (`test/homology-reduced.test.ts:65-86`; `bench/data/reduced_vr_results.txt:100-105`).

The archived collapsed measurements show why collapse cannot be selected by triangle density alone:

| Case | Full baseline triangles | Reduced default | Collapsed reduced | Collapsed speedup in the archived run |
| --- | --: | --: | --: | --: |
| Wine, 0.25 | 0 | 0 | 0 | 1.01x |
| Wine, 0.45 | 687 | 347 | 157 | 0.93x |
| Seeds, 0.15 | 99 | 83 | 22 | 0.80x |
| Seeds, 0.35 | 19,039 | 2,661 | 610 | 6.39x |
| Iris, 0.20 | 6,596 | 1,169 | 188 | 3.27x |
| Iris, 0.35 | 39,360 | 3,089 | 314 | 20.06x |

The rows and the warning that the historical and current Iris protocols differ are in `bench/data/reduced_vr_results.txt:100-118`. The collapsed path can remove 78% of the triangles in the dense Wine case and still lose time. Triangle count is a memory/work proxy, not a measured time model.

## Cost signals available before selection

Define `T_g` as the triangle count returned by `countImplicitTriangles` for the implicit skeleton. Because that skeleton is built with `collapseMaxDim: 2`, `T_g` is a count after the shared edge-collapse gate, not necessarily the original uncollapsed flag-complex count (`src/core/complex-implicit.ts:24-27, 80-114`).

| Signal | Available before choosing the final engine? | How it can be obtained in the current code | What it predicts | Main failure mode |
| --- | --- | --- | --- | --- |
| `n`, `dims`, public `maxDim`, `maxDist`, `epsilon`, `collapse` | Yes | Directly from the call options and point-array length | Hard eligibility, distance cost, geometric dimensionality, and option semantics | None for routing, but `maxDist` alone says nothing about realized density |
| Effective cutoff | Yes | `enclosingRadius` caps an unbounded cutoff at `min_i max_j d(i,j)`; the reduced engine does this before edge work (`src/core/distance.ts:21-57`; `src/core/homology-reduced.ts:127-136`) | Whether the graph can be treated as a full graph and how much pair scanning remains | An unbounded reduced call still uses its brute-force pair path, while the standard skeleton can use the grid after capping (`src/core/homology-reduced.ts:138-164`; `src/core/rips-skeleton.ts:74-82`) |
| `E`, edge density `2E / (n(n-1))`, average degree `2E/n` | Yes, after the skeleton | The preflight complex contains `edges` and `adjBits`; the current selector does not retain them as selection metadata (`src/core/rips-skeleton.ts:118-179`) | Edge sorting, bitset width, collapse eligibility, and common-neighbor work | High average degree can still have few triangles, while a low average degree can contain a dense local cluster |
| `T_g` | Yes, exactly | Already computed by current `auto` before dispatch (`src/core/homology-unified.ts:129-153`) | Whether standard triangle construction has enough work for reduced to repay its lune pass | It says nothing about `T_reduced`, which depends on lune components, and the count itself can be expensive |
| Triangle density `T_g / C(n,3)` | Yes, derived | Divide `T_g` by the complete three-vertex maximum | A rough scale for full triangle enumeration | Global density hides topology and local clustering; the repository's own regime analysis reports overlapping outcomes and declines a single threshold for its streaming comparison (`bench/benchmark.ts:1113-1123, 1241-1277`; `bench/data/regime_results.txt:78-108`) |
| Common-neighbor and lune-size histogram | Only with another scan or a sample | The reduced loop already computes common-neighbor bitsets and lune points, but no dry-run API exposes the histogram (`src/core/homology-reduced.ts:227-265`) | Directly predicts the reduced triangle count and union-find cost | A sample can miss a rare dense region; a full scan duplicates much of reduced construction |
| `T_reduced`, `E_c`, `T_c` | Only after paying the relevant pass | Run the reduced construction or `collapseDominatedEdges`, then inspect the returned counts | The strongest empirical work ratios | The preflight cost is already paid, so it can erase the benefit; collapse output is not guaranteed minimal |
| Collapse gates | Yes | `E >= 3`, `n <= 2048`, requested simplex dimension at least `2`, and the large-`n` average-degree gate (`src/core/edge-collapse.ts:96-110`) | Whether collapse will execute at all | “Executes” does not mean “pays”; the Wine dense case is a direct counterexample |
| Peak heap and wall time | No | Only from a complete candidate run; the current benchmark measures these after execution (`bench/reduced-vr-comparison.ts:153-189`) | Actual selection quality on the target runtime | Timing is noisy, and a policy that measures both candidates has already paid for both |
| Current preflight size limit | Yes, as a hard implementation fact | `CombinatorialIndex` rejects `n >= 2300` (`src/core/combinatorial-index.ts:5-9`) | Whether the existing `auto` probe can run | It is an implementation limit, not a mathematical reduced-engine limit |

The cheapest useful future probe is therefore a shared edge skeleton plus `E`, degree statistics, and `T_g`. It is not a universal reduced-versus-cohomology decision. A stronger policy would need a bounded reduced-preparation probe that reports `T_reduced` and an estimated lune work, or a calibrated model built from direct unified candidate timings. Neither exists in the current API.

## Recommended decision table

The density labels below are intentionally qualitative. “High” means a large measured `T_g` plus enough common-neighbor work to make a reduced probe worthwhile; it does not mean a fixed percentage cutoff. The current data does not justify a numeric threshold.

| Public `maxDim` | Cutoff | Density signal | Collapse mode | Recommended `auto` result | Confidence and reason |
| --: | --- | --- | --- | --- | --- |
| `0` | Any | Any | Any | Existing H0 route; never select reduced | High. Reduced still builds triangles and H1 before scope filtering (`src/core/homology-reduced.ts:212-356`) |
| `1` | Finite | `T_g = 0` or very low | `false` | Existing cohom/implicit route | High. The archived Wine zero-triangle case is 0.82x for reduced (`bench/data/reduced_vr_results.txt:29-36`) |
| `1` | Finite | Low but nonzero | `true` | Existing route; do not invoke collapse automatically | High. The archived Seeds sparse case is 0.32x for reduced and 0.80x for collapsed reduced (`bench/data/reduced_vr_results.txt:46-49, 109-114`) |
| `1` | Finite | High, with a favorable measured reduced probe | `false` | Reduced is a candidate, but only behind an explicit policy/feature flag until unified benchmarks exist | Medium-low. Dense cases show large wins, but the current benchmark baseline is not `auto` |
| `1` | Finite | High, collapse gates pass, and post-collapse `E_c/T_c` show a clear win | `true` | Collapsed reduced is a candidate for an opt-in policy, not a default | Medium-low. The path is exact for covered H0/H1 cases, but collapse time is not predicted by triangle reduction (`bench/data/reduced_vr_results.txt:109-118`) |
| `1` | Finite | High, but collapse is a no-op or its post-collapse work is not clearly lower | `true` | Existing route for `auto`; if the caller explicitly selected reduced, preserve the requested reduced path | High. The helper's gates only say whether it runs, and GUDHI's source warns that dense storage can hurt sparse inputs ([GUDHI source](https://raw.githubusercontent.com/GUDHI/gudhi-devel/master/src/Collapse/include/gudhi/Flag_complex_edge_collapser.h)) |
| `1` | `Infinity` | Any | Any | Existing `auto`; reduced remains explicit/benchmark-only | High. The reduced implementation caps the cutoff but chooses brute-force edge construction for an originally unbounded call, and no current real-data result establishes an unbounded crossover (`src/core/homology-reduced.ts:127-164`) |
| `2` | Any | Any | Any | Existing cohom/implicit/standard route; reduced is forbidden | High. The unified reduced branch rejects public `maxDim > 1` (`src/core/homology-unified.ts:209-218`) |
| Any | Any | Any | Any, with `epsilon` set | Implicit/Sheehy route; reduced is forbidden | High. `auto` already routes epsilon to implicit, and reduced has no epsilon parameter (`src/core/homology-unified.ts:129-156`; `src/core/homology-reduced.ts:120-125`) |
| Any | Any | Any, with `n > 2048` | `collapse: true` | Do not select collapse; for `n >= 2300`, do not use the current implicit preflight without replacing it | High. Collapse returns unchanged above 2048, while the implicit combinatorial index rejects 2300 (`src/core/edge-collapse.ts:72-85`; `src/core/combinatorial-index.ts:5-9`) |

For a future implementation, the conservative dispatch shape is:

```text
epsilon present                         -> implicit
public maxDim is not 1                 -> existing auto
cutoff is unbounded                     -> existing auto
T_g unavailable or low                  -> do not use the current implicit preflight for reduced selection
high-work H1 candidate                  -> compare a reduced preparation probe
probe does not beat current estimate    -> existing auto
probe wins by a calibrated margin       -> reduced
collapse remains an explicit reduced option until separately measured
```

The probe should be a policy decision, not a hidden second full reduction. If TopoJS cannot expose or reuse a skeleton without duplicating the current preflight and the selected engine, the simplest correct choice is to leave `auto` unchanged.

## Counterexamples and reasons not to automate

1. **Sparse graphs can have a zero-triangle baseline.** The reduced engine still scans edges and looks for lune membership, so Wine at zero full triangles is slower in the archived run (`bench/data/reduced_vr_results.txt:29-36`). A policy that selects reduced merely because the graph has many edges would regress this case.

2. **Collapse can shrink triangles and still lose time.** Dense Wine falls from 687 baseline triangles to 157 collapsed reduced triangles but records 0.93x in the archived collapsed run (`bench/data/reduced_vr_results.txt:109-112`). The collapse scan and dense value matrix can cost more than the downstream work they remove.

3. **The current benchmark answers the wrong comparison for `auto`.** It compares direct standard H1 with reduced H1, while public H1 `auto` maps to internal dimension 2 and enables automatic edge collapse in the full builders (`bench/reduced-vr-comparison.ts:324-328`; `src/core/homology-unified.ts:126, 160-168`; `src/core/complex.ts:47-50`). A reduced threshold based on that table would compare different preprocessing states.

4. **Triangle density does not determine lune-component work.** The reduced triangle count is a count of connected components of each edge lune, not a fixed fraction of the full triangle count ([Koyama et al., reduced-complex definition](https://arxiv.org/html/2307.16333v2#S3.SS1)). TopoJS's implementation additionally performs an O(`|lune|²) union-find pass (`src/core/homology-reduced.ts:260-277`). Global `T_g` can therefore be a poor proxy for the exact reduced cost.

5. **The current preflight can erase a small-input win.** `auto` builds and counts an implicit complex before it calls the chosen engine (`src/core/homology-unified.ts:129-168`). The reduced engine then has to build its own edge list and edge index. For small or very sparse inputs, the selector's work is part of the latency being optimized.

6. **The current preflight does not scale to all `n`.** Its `CombinatorialIndex` rejects `n >= 2300` (`src/core/combinatorial-index.ts:5-9`), while the reduced engine itself allocates an n-by-n edge index (`src/core/homology-reduced.ts:183-195`). A policy must distinguish a mathematical reduced-engine limit from an implementation probe limit.

7. **The source paper does not make this an H2 replacement.** The current v3 paper generalizes its theorem in an appendix, but its practical algorithm remains degree-1 ([v3 abstract](https://arxiv.org/abs/2307.16333v3), [higher-degree appendix](https://arxiv.org/html/2307.16333v3#A1)). TopoJS's local contract is H0+H1, and the public unified branch rejects H2 requests (`src/core/homology-unified.ts:209-218`).

8. **Collapse has no canonical minimal output.** Glisse and Pritam explicitly leave open which swap/shift/trim sequence is smallest, and GUDHI exposes repeated iterations ([Glisse and Pritam, optimality discussion](https://arxiv.org/html/2203.07022v1#S4); [GUDHI API](https://gudhi.inria.fr/python/latest/edge_collapse.html)). An automatic policy should compare the selected one-pass implementation, not assume that a successful collapse is globally optimal.

9. **The current API does not define `collapse: true` as an `auto` preference.** The option is consumed only by the reduced branch, while the local specification says other engines ignore it (`.scratch/collapsed-reduced-h1/spec.md:32-45`). Changing that behavior would be a public contract change, not merely an optimization detail.

10. **The available benchmark corpus is narrow.** The reduced benchmark uses approved real datasets and two cutoff regimes, but its code compares only the direct standard and reduced engines (`bench/reduced-vr-comparison.ts:24-36, 324-407`). It does not provide a cross-dataset `auto` policy, an unbounded reduced benchmark, or a calibrated cost model. The repository's own docs therefore correctly keep reduced as opt-in (`README.md:170`).

## Recommendation

The lowest-risk change is documentation and measurement first:

1. Keep the current `auto` result for every existing call, especially H0/H2 and epsilon requests.
2. Add a benchmark matrix that calls the public unified API with `maxDim: 1` and compares `auto`, `cohomology`, `implicit-full`, `reduced`, and `reduced + collapse` on the same real inputs and cutoffs. Record the preflight signals alongside time and counts.
3. Add a reusable skeleton or preparation probe only if the benchmark shows that the current duplicate preflight is material. The probe should report `E`, degree statistics, `T_g`, and, when affordable, `T_reduced` and post-collapse counts.
4. Calibrate a reduced fallback against the actual unified cohom/implicit candidate. Do not reuse the 8K/60K implicit thresholds or the standalone reduced benchmark ratios.
5. Keep `collapse` explicit. A future automatic collapse branch should require the existing hard gates plus a measured post-collapse benefit; the local implementation plan already places an automatic density threshold out of scope (`.scratch/collapsed-reduced-h1/performance-distance-matrix-spec.md:56-68`).
6. If a reduced candidate is enabled behind a flag, make the fallback observable in benchmark output. Otherwise users will see a silent engine change with no reliable way to explain a sparse-case regression.

The defensible policy is therefore conservative eligibility now, measured selection later. Reduced H1 is worth keeping as a public explicit engine, and collapsed reduced H1 is worth keeping as an explicit dense-case option, but neither currently has enough evidence to be selected silently by `auto`.

## Follow-up measurement

The public matrix is implemented in `bench/reduced-vr-comparison.ts` and exposed as `npm run bench:auto-matrix`. It records the current public `auto`, cohomology, implicit-full, reduced, and reduced-collapse candidates on the approved real cases. The matrix writes `bench/data/auto_engine_matrix_results.txt`. It does not change production dispatch.

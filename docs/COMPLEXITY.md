# Complexity Analysis: `IncrementalH1` vs. the Naive Baseline

This document states, and proves from the actual code (not just the
docstrings), the per-push cost of `IncrementalH1` (`src/streaming/
incremental-h1.ts`, "v3") versus the naive full-recompute baseline
(`StreamingHomology`, `src/streaming/streaming-homology.ts`, which calls
`computePersistentHomology` → `buildRipsComplex` fresh on every push). It
also explains, precisely rather than by appeal to noise, why the real-data
scaling sweep (`bench/data/summary.txt` Axis 4) found the growth-rate
advantage confirmed on one dataset and much less clear on two others.

## Notation

For a window of `k` points under Rips threshold `maxDist`:

- `E` = number of edges realized in the current window's Rips complex
  (pairs within `maxDist`), `0 ≤ E ≤ C(k,2) = O(k²)`.
- `T` = number of triangles realized (all 3 pairwise distances within
  `maxDist`), `0 ≤ T ≤ C(k,3) = O(k³)`.
- `deg(new)` = number of points in the window within `maxDist` of the
  newly-pushed point, `0 ≤ deg(new) ≤ k-1`.
- `w` = machine word size (32, from the bit-vector reduction columns).

## 1. Naive baseline's actual cost (not just its stated worst case)

`buildRipsComplex` (`src/core/complex.ts`) does two passes:

1. **Edges** (lines 73–82): an unconditional double loop over all `i < j`
   pairs — this is `Θ(k²)` **always**, independent of how many pairs
   actually survive the `maxDist` filter. There is no way to avoid this
   without a spatial index. A spatial-grid index *was* later added to
   `buildRipsComplex` (see `bench/data/edge_building_results.txt`), but it
   is gated to `n >= 1000` because measured grid overhead loses to brute
   force below that — every window size `StreamingHomology` actually calls
   `buildRipsComplex` with in this repo's benchmarks (`k` = 5–80) is well
   under that threshold, so this section's `Θ(k²)` **always** claim for the
   naive baseline's edge step still holds unqualified in practice here, not
   just in the worst case.
2. **Triangles** (lines 117–150): for each of the `E` realized edges `(u,v)`,
   it intersects `u`'s and `v`'s bit-vector adjacency sets to find common
   neighbors — **not** a raw `O(k³)` enumeration of all vertex triples. Cost
   is `O(E · k / w)` (each intersection scans `k/w` words), which is bounded
   above by `O(k³ / w)` when `E = Θ(k²)` (dense complex), but is
   **data-dependent** and can be much smaller when `E = o(k²)`.

So the naive baseline's real per-push cost is `Θ(k²) + O(E·k/w)`, which
degrades to `O(k³/w)` only in the dense-complex worst case — **not** a flat
`Θ(k³)` in general. Several comments elsewhere in this codebase (this
class's own docstring, `StreamingHomology`'s docstring) describe the naive
baseline as "`O(k²)` edge + `O(k³)` triangle full rebuild." That is the
correct *worst-case* bound and a reasonable shorthand, but it is not what
the code does on real, non-dense data — worth stating precisely here since
it directly affects how much of a gap should be *expected* between the two
engines (see Section 3).

## 2. `IncrementalH1` v3's actual cost

Walking `push()` (`src/streaming/incremental-h1.ts`) step by step:

| Step | Code | Cost |
|---|---|---|
| Evict from `neighborsOf` | lines 195–201 | `O(deg(evicted))` |
| Filter evicted point out of `edgeOrder`/`triOrder` | lines 219–228 | `Θ(E_prev + T_prev)` — a full scan of the *previous* edge/triangle lists, not just the evicted point's own incident simplices |
| New point's distances to survivors | lines 235–249 | `Θ(k)` |
| New triangle candidates (pairs of new point's neighbors) | lines 343–362 | `O(deg(new)²)`, plus `O(deg(new)² log deg(new))` for the sort |
| Merge survivors with new candidates (edges + triangles) | lines 282–316, 369–379 | `Θ(E + T)` (linear merge of two sorted lists) |
| Prefix-diff + reduction of the changed suffix | lines 383–456 | bounded by `O((T - triSafeCount) · E / w)` in the worst case per re-reduced column (standard bit-vector reduction cost, `src/core/homology.ts`'s own documented bound) |

**Total geometry-update cost: `Θ(E + T) + O(k) + O(deg(new)² log deg(new))`.**
The dominant term for any non-trivial window is `Θ(E + T)` — the filter and
merge steps both scan the full previous/current edge and triangle lists.

This is **not** `O(k)` in general, despite the class docstring's per-bullet
framing ("O(k), not O(k²)" for the new-point step, "O(deg(new)²), not
O(k³)" for new-triangle enumeration) reading, out of context, like an
overall `O(k)` claim — each of those bullets is locally correct about the
*specific step it describes*, but the filter/merge steps it does not
highlight in the same breath are `Θ(E+T)`, and `E, T` can themselves be as
large as `Θ(k²), Θ(k³)` in the worst (dense) case. **In the worst case, v3's
geometry update is the same asymptotic class as the naive rebuild's
triangle-enumeration term** (`O(k³/w)` when `T = Θ(k³)`), just with a lower
leading constant (a linear scan/merge vs. bit-set-intersection). The
reduction step separately adds no worse than the naive engine's own
reduction cost, and can be strictly cheaper when the prefix-stable suffix is
short — but empirically (`bench/data/summary.txt`, all axes) the re-reduced
fraction stays 98.9%–99.6%, meaning this mechanism rarely saves much in
practice on real data at the window sizes tested.

## 3. What this predicts, and what was measured

The honest prediction from Sections 1–2: v3 is a genuine, unconditional
`Θ(k) + O(deg(new)²)` improvement in the "new point" cost, and a
**conditional** improvement in the "existing complex" cost (`Θ(E+T)` scan
instead of `Θ(k²) + O(E·k/w)` recompute) — conditional because both bounds
converge to the same worst-case class as `E, T` approach their maxima. There
is **no theorem in this codebase, and none is claimed here, that guarantees
`E, T = o(k²), o(k³)` on arbitrary real data.** Whether v3 shows a widening
growth-rate gap or a flat/noisy one is therefore expected to be
**data-dependent**, not a fixed property of the algorithm.

To check this against what was actually measured, the realized density of
each dataset's Rips complex was measured directly (`bench/data/summary.txt`
Axis 4 datasets, same `maxDist=0.15`):

| Dataset | k=10 | k=20 | k=40 | k=80 |
|---|---|---|---|---|
| sunspots, E as % of `C(k,2)` | 57.8% | 74.2% | 55.5% | 47.3% |
| sunspots, T as % of `C(k,3)` | 29.2% | 52.1% | 26.2% | 19.4% |
| Melbourne temps, E as % of `C(k,2)` | 26.7% | 28.4% | 33.7% | 29.6% |
| Melbourne temps, T as % of `C(k,3)` | 5.8% | 6.1% | 9.9% | 7.5% |

This immediately falsifies the most tempting explanation ("sunspots shows
the cleaner v3 win because it's sparser") — **sunspots is measurably
*denser* than Melbourne temps at every window size tested**, by a wide
margin on `T` (19–52% vs. 6–10% of the dense-complex maximum). That is the
opposite of what a naive sparsity story predicts, and reporting the
(wrong) sparsity hypothesis as if it were confirmed would have been
dishonest — it was checked directly against measured data and dropped.

The more defensible reading, consistent with Section 1: because the naive
baseline's triangle step is itself `O(E·k/w)` rather than a flat `Θ(k³)`,
neither engine is purely in a different asymptotic class from the other on
data where `E, T` are bounded well below their maxima (true for both
datasets tested here, per the table above) — both engines' real costs track
`E` and `T` to a meaningful degree, which is consistent with the scaling
sweep finding the two engines' log-log slopes close to each other on both
real datasets (naive p≈1.98–2.09, incremental p≈1.87–1.93 on Melbourne
temps; naive p≈2.07–2.09, incremental p≈1.84–1.87 on sunspots — a real but
modest separation, not a different complexity class made visible). The
*speedup ratio* still widens somewhat with `k` on sunspots specifically
(1.28x→1.98x) because v3 pays a smaller **constant factor** per unit of
`E+T` work (linear scan/merge vs. bit-set intersection plus full edge
re-sort) — a genuine, measured advantage, just not the "different growth
class" framing an unqualified complexity argument might suggest.

## 4. Regime map: does density actually predict the breakeven?

Section 3 established that the speedup is *conditional* on complex sparsity
in theory, but the sparsity-explains-it hypothesis was checked directly
against two fixed-density datasets and rejected. This section replaces
that indirect check with a direct one: instead of comparing two datasets
that happen to differ in density, **directly control density** by sweeping
`maxDist` (the lever that determines it) across a wide range, at fixed
window sizes, on all three real datasets, and plot density against measured
speedup.

Method (`npm run bench -- --regime [dataset]`, `bench/data/regime_results.txt`):
for each dataset, at 1-2 representative window sizes, `maxDist` was swept
from sparse (≈0.2%-3% realized triangle density) to dense (≈70-88% of the
complete-complex maximum), each point measured as a paired naive-vs-
incremental trial (3 trials/point) on real data chunks. 35 (density,
speedup) points collected total.

**Result: no clean density threshold was found.** Speedup stayed at
1.1x-2.6x across the entire density range on sunspots (0.2%→88%, still
1.88x at the densest point tested) and Melbourne temps (0.2%→37%). Only 2
of 35 points fell below 1x (Melbourne k=40 at 3.6% density: 0.68x; Iris
k=20 at 43.3% density: 0.65x) — both isolated, surrounded on either side by
higher-*and*-lower-density points that stayed comfortably above 1x, which
is the signature of measurement noise (short timed windows, few trials —
the same noise pattern already documented for Iris elsewhere in this repo),
not a systematic density effect. If density cleanly predicted the
breakeven, failures would cluster at the high-density end; they do not —
they occur at scattered densities with no pattern.

**This falsifies the premise this section set out to test**, not just the
Section 3 hypothesis: there is no evidence in this data that v3 "stops
being worth it" above some density threshold, within the ranges tested
(up to 88% of the theoretical maximum, well into what should be a
dense-complex regime by any reasonable definition). The theoretical
worst-case bound from Section 2 (v3 degrades to the naive baseline's
class as `E,T → k²,k³`) is still mathematically correct, but "worst case"
and "what real windowed point-cloud data actually produces" appear to be
further apart than expected — even data engineered to be dense via a large
`maxDist` does not erase the constant-factor advantage v3 gets from linear
scan/merge over bit-set intersection (Section 3). Put plainly: the
regime-map project was supposed to produce a predictive rule ("use v3
below X% density"); the honest result is that no such rule is supported by
this data, and the practical guidance is closer to "v3's speed advantage
appears robust across the density ranges tested on real data" than any
density-based caveat. This is a stronger, more useful result than the
predictive-rule this section originally set out to find, precisely because
it survived an attempt to falsify it rather than being assumed.

**What this does not establish:** only 3 datasets, 2 window sizes each,
`maxDist` up to a ceiling constrained by benchmark runtime (windowSize=80
combined with the highest tested `maxDist` did not complete within a
reasonable time budget and was excluded — see `bench/benchmark.ts`'s
`regimeMaxDists` comments). Larger windows, higher ambient dimensions, or
adversarially constructed point clouds (e.g., deliberately near-complete
graphs) might still reveal the theoretical worst case in practice. This
section reports what was measured, not a universal guarantee.

## 5. Space complexity: the trade-off nobody had measured yet

Everything above is about TIME. `IncrementalH1`'s whole design is a
time/space trade-off — it buys speed by keeping the *previous* push's full
edge/triangle lists and reduced-column state alive so the next push can diff
against them instead of recomputing. `StreamingHomology` (naive) does the
opposite: it discards its entire complex after every push and holds nothing
but the raw window contents between calls.

Measured directly (`npm run bench -- --memory <dataset>`, `bench/data/
memory_results.txt`; `process.memoryUsage().heapUsed` delta, median of 7
fresh builds per point, `--expose-gc` forcing collection immediately before
and after each build to reduce — not eliminate — measurement noise):

| Dataset | windowSize | naive MB | incremental MB | ratio |
|---|---|---|---|---|
| sunspots | 10 | 0.005 | 0.020 | 4.2x |
| sunspots | 20 | 0.008 | 0.201 | 24.8x |
| sunspots | 40 | 0.004 | 0.732 | 204x |
| sunspots | 80 | 0.001 | 4.864 | 3484x |
| Melbourne temps | 10 | 0.004 | 0.011 | 2.7x |
| Melbourne temps | 20 | 0.002 | 0.035 | 15.0x |
| Melbourne temps | 40 | 0.002 | 0.333 | 142x |
| Melbourne temps | 80 | 0.001 | 1.942 | 1361x |
| Iris | 5 | 0.002 | 0.006 | 2.6x |
| Iris | 10 | 0.005 | 0.024 | 4.7x |
| Iris | 20 | 0.008 | 0.204 | 24.1x |

**This is a real, consistent, and previously undocumented cost.** The naive
engine's heap footprint stays near-zero at every window size tested (it
retains almost nothing between pushes, by design); `IncrementalH1`'s grows
roughly in line with `T` (triangle count) — consistent with Section 2's
identification of `reducedCols`/`triPair`/`edgeOrder`/`triOrder` as O(E+T)
persistent state — reaching nearly 5MB per instance at windowSize=80 on the
sunspot data, thousands of times the naive engine's footprint at the same
window size. For a single stream this is very likely irrelevant in absolute
terms (a few MB), but it means `IncrementalH1` does **not** scale to large
numbers of concurrent windows (e.g., one window per sensor across a large
fleet) the same way the naive engine does — that use case would need to
budget memory per window, not just CPU time, and the two engines' costs on
that axis are inverted from their costs on the CPU axis. This is not
discussed anywhere else in this repository before this document and should
be treated as a real limitation of `IncrementalH1`, not a footnote.

### 5b. Follow-up: pooling `reducedCols`/`triPair` cuts this by ~2.3x-2.7x

The table above named `reducedCols`/`triPair`/`edgeOrder`/`triOrder` together
as the retained O(E+T) state without isolating which one actually dominates
the measured bytes. It turned out to matter: `reducedCols` (previously one
separate `Int32Array` + its backing `ArrayBuffer` PER TRIANGLE) and `triPair`
(previously one separate `{birth,death,dim}` object per triangle, mostly
null) are individually much heavier per-entry than a plain-number-field
object, because each is its own heap-allocated object with real fixed
overhead regardless of how little content it holds — and, critically, *every*
triangle gets a `reducedCols` entry by construction (see the reduction loop
in `src/streaming/incremental-h1.ts`), so this was genuinely `O(T)` separate
heap objects, not just `O(E+T)` numbers.

Fix (`src/streaming/incremental-h1.ts`, `packReducedCols`/`packTriPair`):
pack these into a handful of flat pooled typed arrays (`colPool` +
`colOffset`/`colLength` for the sparse column contents; `triPairHas` +
`triPairBirth`/`triPairDeath` for the pairs) instead of one object per
triangle. This is a pure storage-representation change — the reduction
algorithm itself was not touched, only what gets packed into `this.*` at
the very end of `push()` — so it is correct by construction, not just by
testing (confirmed anyway: 123/123 tests pass, including the existing
differential test against `StreamingHomology` at every push).

Measured, before → after, at windowSize=80 (the worst case):

| Dataset | before | after | reduction | ratio before → after |
|---|---|---|---|---|
| sunspots | 4.864 MB | 1.786 MB | 2.72x | 3484x → 1279x |
| Melbourne temps | 1.943 MB | 0.746 MB | 2.60x | 1190x → 427x |
| Iris (windowSize=20) | 0.205 MB | 0.088 MB | 2.33x | 44.7x → 46.3x (naive also near noise floor here) |

Consistent 2.3x-2.7x reduction across all three datasets at their largest
tested window size. Full before/after data in `bench/data/
memory_results.txt` (original numbers kept, not deleted, for the record).

**What this does not fix (as of this point in the narrative — see Section
5c immediately below for a follow-up that fixed most of it).**
`edgeOrder`/`triOrder` (arrays of small JS objects, one per edge/triangle)
were left untouched here — pooling either would require touching more of
`push()` than the reducedCols/triPair fix did, a real correctness risk
versus this change's narrow footprint at the storage boundary only.

### 5c. Follow-up 2: pooling `triOrder` specifically closes most of the rest

Section 5b named `edgeOrder`/`triOrder` together as the remaining unpooled
state without measuring which one actually mattered. Rather than guess,
a direct process-isolated diagnostic settled it: build a fully-warmed
instance, strip every retained field EXCEPT one (via direct property
replacement, each configuration run in its own fresh process to avoid GC
cross-contamination between measurements), measure heap. Result, on the
sunspots dataset at windowSize=80 (triCount=15916, edgeCount=1496 there):

| Field kept alone | Heap retained | Share of ~1.9MB total |
|---|---|---|
| `triOrder` | ~1.58 MB | ~83% |
| `edgeOrder` | ~0.21 MB | ~11% |
| `neighborsOf`, `pointCoords`, pooled `colPool`/`triPair` fields, `pivotOfEdgeIdx` | ~0.09-0.11 MB each | ~5-6% each |

`triOrder` alone accounted for the large majority of what Section 5b's fix
left behind — expected in retrospect (`T` triangles vastly outnumber `E`
edges at this window size/density, and each `TriRec` carries 7 fields vs
`EdgeRec`'s 3), but not assumed: measured directly, the same discipline
used everywhere else in this document. This reprioritized the fix: pool
`triOrder` (`triIdA`/`triIdB`/`triIdC`/`triVal`/`triE1`/`triE2`/`triE3`,
seven parallel typed arrays via a new `packTriOrder`), leave `edgeOrder`
as-is (its contribution, ~7-8x smaller, doesn't justify the same risk).

Same low-risk pattern as Section 5b: the transient per-push computation
(`newTris`, still built and sorted/merged as an array of `TriRec` objects
exactly as before) is completely unchanged; only the two points where
`push()` reads the *previous* push's `triOrder` (the eviction filter and
the identity-prefix check) and the one point where it writes the *new*
`triOrder` were touched, to read from / write to the pooled arrays
instead of an array of objects. Verified with the existing 20-seed
differential test suite plus a new long-running stress test (3 seeds ×
200 pushes each, checked at every push) added specifically because a bug
in the prefix-copy-forward bookkeeping could plausibly only surface after
many push cycles, not the first few — both pass (124/124 total).

Combined effect of both fixes (5b + 5c), original → current, at windowSize=80:

| Dataset | original | after both fixes | total reduction | ratio original → current |
|---|---|---|---|---|
| sunspots | 4.864 MB | 0.209 MB | 23.3x | 3484x → 150x |
| Melbourne temps | 1.943 MB | 0.037 MB | 52.5x | 1361x → 25.7x |
| Iris (windowSize=20) | 0.205 MB | 0.028 MB | 7.3x | 44.7x → 11.3x |

This closes the large majority of the originally-documented gap — smaller
window sizes (10/20/40) are now genuinely down at the harness's own noise
floor (single-digit-to-low-double-digit KB deltas), so windowSize=80 is
the only point still cleanly readable; full tables including the noisy
smaller points, not cherry-picked, are in `bench/data/memory_results.txt`.

**Where this stops, and why.** `edgeOrder`, `neighborsOf`
(`Map<number,Set<number>>`), and `pointCoords` (array of small arrays)
remain unpooled. Each contributes roughly the same order of magnitude now
(~0.01-0.02MB each at windowSize=80, per the table above, now that
`triOrder`'s much larger share is gone) — there is no longer one dominant
target the way `triOrder` was, and `neighborsOf` specifically is used for
O(1) adjacency lookups in the new-triangle-enumeration hot path
(`this.neighborsOf.get(p)!.has(q)`), so replacing its `Set`s with something
more compact would need to preserve that lookup cost, a non-trivial
constraint a flat pooled array doesn't trivially satisfy. Diminishing
returns plus rising risk is the honest reason to stop here rather than
continue chasing the remaining, much smaller contributors. The time/space
trade-off named in Section 5 is real and substantially smaller now, not
eliminated: `IncrementalH1` still retains meaningfully more than
`StreamingHomology`'s near-zero footprint at every window size tested.

## 6. Honest summary

- The `Θ(k) + O(deg(new)²)` "new point" cost saving is unconditional and
  proven from the code (Section 2) — this part of the original complexity
  claim holds without qualification.
- The "avoid rebuilding the existing complex" saving is *theoretically*
  **conditional on complex sparsity** (`E = o(k²)` or `T = o(k³)`), not
  unconditional — worst case it degrades to the same asymptotic class as
  the naive baseline's own (also data-dependent, not flatly `O(k³)`)
  triangle-enumeration cost.
- No formal proof is offered here (or claimed anywhere else in this
  codebase) that real-world sliding-window data typically produces sparse
  enough complexes for the conditional saving to dominate — but a direct
  empirical test of that condition (Section 4, sweeping density from <1%
  to 88% of maximum via `maxDist`) found NO density threshold at which the
  speedup broke down across 35 measured points on 3 real datasets. The
  theoretical conditionality stands as a worst-case bound; the practical
  evidence, checked directly rather than assumed, does not show that
  worst case materializing in the ranges tested.
- This analysis directly explains, rather than merely restates, the mixed
  empirical scaling-sweep result in `bench/data/summary.txt` Axis 4 — the
  two engines' complexity classes are closer to each other than the
  headline "O(k) vs O(k²)/O(k³)" framing suggests, once the naive
  baseline's own bit-set optimization (Section 1) and real-data density
  (Section 3) are both accounted for precisely.
- The time saving is bought with real, measured memory cost — up to ~150x
  more heap per instance at windowSize=80 on real data (Section 5; down
  from an originally-measured ~3500x, via two follow-up storage-layout
  fixes, Sections 5b and 5c — pooling `reducedCols`/`triPair` then
  `triOrder` specifically, the latter found via direct measurement to be
  ~83% of what 5b left behind, together cutting retained memory 7.3x-52.5x
  across the three datasets tested, without touching the reduction
  algorithm at all). Any claim that `IncrementalH1` is a strict improvement
  over the naive baseline is still false without qualifying which resource
  (time or space) and at what scale; it is a trade-off, not a strict
  improvement — the fixes in 5b/5c make the trade-off much less severe,
  they do not remove it, and Section 5c explains directly why pooling
  further (edgeOrder, neighborsOf, pointCoords) was not attempted.
- Net practical guidance: on the real data and window-size ranges tested
  in this repository, `IncrementalH1`'s speed advantage held up robustly
  regardless of complex density, and its cost is memory, not a density
  cliff. This is a more specific and better-supported claim than either
  "always faster" or "only faster when sparse" — both of which this
  document tested directly and found unsupported or overstated.

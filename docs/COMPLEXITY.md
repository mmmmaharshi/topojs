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
   without a spatial index (not implemented here) — a genuine, unavoidable
   `Θ(k²)` per push.
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

## 4. Space complexity: the trade-off nobody had measured yet

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

## 5. Honest summary

- The `Θ(k) + O(deg(new)²)` "new point" cost saving is unconditional and
  proven from the code (Section 2) — this part of the original complexity
  claim holds without qualification.
- The "avoid rebuilding the existing complex" saving is real but
  **conditional on complex sparsity** (`E = o(k²)` or `T = o(k³)`), not
  unconditional — worst case it degrades to the same asymptotic class as
  the naive baseline's own (also data-dependent, not flatly `O(k³)`)
  triangle-enumeration cost.
- No formal proof is offered here (or claimed anywhere else in this
  codebase) that real-world sliding-window data typically produces sparse
  enough complexes for the conditional saving to dominate. The measured
  evidence is mixed on the two real datasets checked (Section 3), and this
  is stated as an open question, not resolved by this document.
- This analysis directly explains, rather than merely restates, the mixed
  empirical scaling-sweep result in `bench/data/summary.txt` Axis 4 — the
  two engines' complexity classes are closer to each other than the
  headline "O(k) vs O(k²)/O(k³)" framing suggests, once the naive
  baseline's own bit-set optimization (Section 1) and real-data density
  (Section 3) are both accounted for precisely.
- The time saving is bought with real, measured memory cost — up to
  ~3500x more heap per instance at windowSize=80 on real data (Section 4).
  Any claim that `IncrementalH1` is a strict improvement over the naive
  baseline is false without qualifying which resource (time or space) and
  at what scale; it is a trade-off, not a strict improvement, and should be
  presented as such.

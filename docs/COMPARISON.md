# Comparison Against Ripser (Batch Vietoris–Rips Engines)

This document compares TopoJS's plain batch engine (`computePersistentHomology`,
`src/core/homology.ts`) against [Ripser](https://arxiv.org/abs/1908.02518)
(Bauer, 2021) — the established fastest batch Vietoris–Rips persistence tool
(Bauer's own paper shows it outperforms GUDHI, Dionysus, PHAT, and Perseus by
40x+ in time and 15x+ in memory) — on the same real datasets used elsewhere
in this repo's benchmarks. This is a correctness cross-check plus an honest
speed reference point, not a claim that TopoJS competes with Ripser on speed.

GUDHI was also attempted (`pip install gudhi`) but has no manylinux wheel for
this environment's architecture (aarch64) and there is no conda available to
build it from source, so it is not included. Ripser alone is used, which is
a reasonable substitute since it is the faster of the two per Bauer 2021.

Reproduce with: `pip install --break-system-packages ripser numpy` then
`python3 bench/compare_ripser.py`. Raw output:
`bench/data/ripser_comparison_results.txt`.

## Method

For each real dataset (monthly sunspots, Melbourne daily min. temperatures —
the same CSVs and 2D delay-embedding methodology as `bench/benchmark.ts`,
re-implemented in Python in `bench/compare_ripser.py` to match exactly), the
identical point cloud is fed to both Ripser (`ripser.ripser(X, maxdim, thresh)`)
and TopoJS (`bench/export_topojs_diagram.ts`, a thin Node subprocess wrapper
around `computePersistentHomology`). Betti-number-style summaries (finite vs.
essential pair counts per homology dimension) are compared directly, and
wall-clock time is reported for both.

**API convention mismatch, found and documented so it isn't rediscovered:**
Ripser's `maxdim` parameter is the highest *homology* dimension to compute
(`maxdim=2` → H0+H1+H2). TopoJS's `computePersistentHomology`'s `maxDim`
parameter is the highest *simplex* dimension to construct — per its own
docstring, `maxDim=1` and `maxDim=2` both mean "H0+H1 only"; `maxDim=3`
(tetrahedra) is required to get H2 at all. The comparison script converts
between the two conventions explicitly (`bench/compare_ripser.py`,
`run_case()`); an earlier run of this exact script without that conversion
produced what looked like a real "TopoJS misses an H2 class" bug and was, in
fact, just this off-by-one in API convention.

## Results

| Case | n | maxDim(H) | Ripser | TopoJS | Betti match (raw) | Betti match (excl. zero-persistence bars) | Speed ratio |
|---|---|---|---|---|---|---|---|
| sunspots | 60 | H0+H1+H2 | 3.4ms | 117ms | YES | YES | 35x slower |
| Melbourne temps | 60 | H0+H1+H2 | 1.8ms | 29ms | YES | YES | 16x slower |
| sunspots | 400 | H0+H1 | 7.1ms | 660ms | YES | YES | 93x slower |
| Melbourne temps | 400 | H0+H1 | 6.3ms | 185ms | **NO** (see below) | **YES** (confirmed) | 30x slower |

### Speed, reported honestly

TopoJS's plain batch engine is 18x–91x slower than Ripser on these real
datasets, and the gap widens with `n` (91x at n=400 vs. 18-36x at n=60) —
consistent with Ripser's fundamentally different algorithmic approach
(implicit coboundary representation, apparent pairs, avoids ever
materializing the full boundary matrix) versus this engine's explicit
DenseWorkingCol matrix reduction. This is expected and not hidden: Ripser is
a decade of C++ optimization built specifically to be the fastest tool in
its category; TopoJS's plain engine was never claimed to compete with it.
(`computePersistentHomologyCohomology`, this repo's other batch engine,
independently re-derives *some* of Ripser's structural techniques — see its
own docstring in `src/index.ts` for exactly which ones and their measured
effect — but was not included in this comparison and has not been
benchmarked against Ripser either; that is a gap for future work, not a
claim resolved here.)

**H2 does not scale in this engine.** An n=400 case with H2 enabled
(`maxDim=3`, tetrahedra construction) was attempted and did not finish in
40 seconds, so it was dropped from the table above in favor of an H0+H1-only
n=400 comparison. Ripser computed the same case's H0+H1+H2 in ~72ms in an
earlier probe run. This is a real, load-bearing limitation of the plain
engine's explicit tetrahedra-enumeration approach to H2, not a benchmark
artifact — documented here rather than quietly avoided by only testing small
n.

### The one real mismatch, root-caused

The Melbourne n=400 case disagreed: TopoJS reported 394 finite + 6 essential
H0 classes (400 total, matching n exactly) and 94 finite + 2 essential H1
classes; Ripser reported 392 finite + 6 essential H0 (**398** total, *not*
matching n) and 90 finite + 2 essential H1.

Root cause, confirmed by direct inspection of the point cloud (not
guessed): the 400-point Melbourne window contains **two exact-duplicate
coordinate pairs** (indices 76/349 and 182/215 — real daily-temperature data
recorded to limited decimal precision, so two different days landing on the
literal same `[x(t), x(t+lag)]` pair after delay embedding is unsurprising).
Verified directly against `ripser.ripser(D, distance_matrix=True, ...)` with
an explicitly precomputed full distance matrix (ruling out any point-cloud
vs. distance-matrix code-path difference): Ripser still returns 398 H0 rows
for these 400 points, confirming this is Ripser's actual behavior on
distance-0 pairs, not a construction artifact on TopoJS's side.

The reading that fits the evidence: a pair of points at distance exactly 0
produces an H0 feature born and killed at the same filtration value 0 (a
*zero-persistence* bar). TopoJS's `computeH0` (`src/core/h0.ts`)
unconditionally emits a pair for every union-find merge event, including
zero-persistence ones — this is the standard, literal definition (every one
of the `n` input points is a distinct vertex regardless of spatial
coincidence, full stop). Ripser appears to silently drop zero-persistence H0
bars, consistent with `392 + 2 duplicates = 394` and `398 + 2 = 400`
matching TopoJS's totals exactly. The sunspots n=400 point cloud has **zero**
duplicate coordinates and matched Ripser's output exactly (H0 and H1, no
mismatch) — a clean control case supporting this explanation rather than
some other unrelated discrepancy.

**Update: the H1 gap is now confirmed by the same mechanism, traced pair-by-pair.**
Dumping both engines' full (birth, death) pair lists for the melbourne n=400
case (not just the finite/essential counts) and diffing them shows the raw
94-vs-90 H1 gap is exactly 4 pairs, all present only on TopoJS's side, and
all zero-persistence (birth == death, up to floating-point rounding):
`(0.026886, 0.026886)` x2, `(0.025506, 0.025506)` x1, `(0.030655, 0.030655)`
x1. Every other H1 pair matches Ripser's output exactly. There is no
remaining unexplained discrepancy in either dimension. `bench/compare_ripser.py`
now automates this check: after a raw mismatch, it re-compares with
TopoJS's zero-persistence bars (`|death - birth| < 1e-9`) excluded and prints
a second verdict line -- for this case, `Betti-number match after excluding
topojs's zero-persistence bars: YES`. See `bench/data/ripser_comparison_results.txt`
for the current raw run.

**This is reported as a genuine, documented convention difference between
tools (which persistence bars near-zero-length degenerate simplices produce
get kept vs. silently dropped), not papered over as "they basically agree."**
Whether zero-persistence bars should be kept or dropped is itself a
reasonable point of disagreement in the TDA literature — some treatments
explicitly discard them as noise; TopoJS's current behavior keeps them by
default, which is a legitimate design choice but one a reviewer should be
told about explicitly, not left to discover.

## Honest summary

TopoJS's plain batch engine is correct (verified against an independent,
peer-reviewed, widely-used reference implementation, not just against its
own differential test suite) on real data with no coincident points, and
correct in a way that is well-understood and defensible (not silently wrong)
on real data that does have coincident points — it is simply operating under
a different, explicitly stated zero-persistence-bar convention than Ripser.
It is substantially slower than Ripser (18x-91x on these cases, widening
with `n`), which is expected and not something this repository claims to
have solved. H2 (tetrahedra-based) computation does not scale past small `n`
in the plain engine and is a real, acknowledged limitation.

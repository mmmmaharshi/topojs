# Related Work

This document positions TopoJS's streaming/incremental engine
(`IncrementalH1`, `src/streaming/incremental-h1.ts`) against published prior
work, so a reviewer can see what is genuinely new here and what is a
narrower, cheaper special case of something already known. It does not cover
`computePersistentHomology`/`computePersistentHomologyFast`/
`computePersistentHomologyCohomology` (the batch engines), which are
standard-technique implementations positioned against Ripser/GUDHI in
`docs/COMPARISON.md` instead.

## 1. What `IncrementalH1` actually does

Given a fixed-size FIFO sliding window over a point stream (oldest point
evicted, newest point inserted, window size `k` constant), `IncrementalH1`
maintains the *exact* H0+H1 persistent homology of the Vietoris–Rips complex
on the current window after every push, in:

- `O(k)` time to update the edge/triangle *geometry* (which simplices exist),
  down from the `O(k^2)` edge + `O(k^3)` triangle full rebuild a naive
  recompute-from-scratch approach requires, and
- a prefix-stable *matrix reduction* step that only re-reduces the suffix of
  the filtration order that actually changed, reusing the rest of the
  previous reduction untouched.

It is restricted, by construction, to the FIFO sliding-window update
pattern (exactly one point enters, exactly one point — the oldest — leaves,
every push) and to H0+H1 (H2 is out of scope). Correctness is verified by
differential testing against full recomputation at every push
(`test/incremental.test.ts`), not asserted from complexity arguments alone.

## 2. Vineyards (Cohen-Steiner, Edelsbrunner, Morozov, 2006)

Cohen-Steiner, Edelsbrunner, and Morozov, "Vines and Vineyards by Updating
Persistence in Linear Time," *Proc. 22nd ACM Symposium on Computational
Geometry (SoCG)*, 2006, pp. 119–126.

This is the foundational result for updating persistence incrementally: it
shows that when two adjacent simplices in the filtration order are
transposed, the persistence pairing can be updated in worst-case time
*linear* in the number of simplices per transposition, instead of
recomputing the full reduction. Any sequence of insertions/deletions/
reorderings can in principle be expressed as a sequence of adjacent
transpositions and updated this way ("vineyards").

**Relationship to this codebase:** `IncrementalH1` does not implement general
vineyards. It handles only the specific, much more restricted transposition
pattern that a FIFO sliding window produces (the evicted point's simplices
are removed from the *front* of the filtration order region they occupy, the
new point's simplices are added and merged in) — see the "prefix-stable"
argument in the `IncrementalH1` class docstring. This narrower scope is what
lets the geometry-construction step avoid the `O(k)`-per-transposition cost
implied by a general vineyard walk and instead do a single `O(k)` merge per
push. The trade-off is generality: vineyards handle *arbitrary* simplex
reorderings (e.g., a continuously moving point cloud, not just a discrete
FIFO stream); `IncrementalH1` handles only the FIFO case.

## 3. Zigzag persistence (Carlsson, de Silva, 2010)

Carlsson, G., de Silva, V., "Zigzag Persistence," *Foundations of
Computational Mathematics*, 10(4), 2010, pp. 367–405 (arXiv:0812.0197).

Zigzag persistence generalizes ordinary persistence to sequences of spaces
connected by maps in *either* direction (not just inclusions), which
subsumes arbitrary insertion-and-deletion sequences, including sliding
windows, as a special case. It is the more general theoretical framework
that both vineyards and sliding-window persistence sit inside.

**Relationship to this codebase:** `IncrementalH1` does not use a zigzag
formulation. It is a direct, special-cased algorithm for one specific zigzag
pattern (FIFO insert-then-delete-oldest) rather than an implementation of
the general zigzag machinery, which carries higher constant/implementation
complexity than is needed for that one pattern.

## 4. Streaming persistent homology via data summarization (Moitra, Malott, Wilsey)

- Moitra, A., Malott, N.O., Wilsey, P.A., "Persistent Homology on Streaming
  Data," (genomic-evolution application; conference paper, NSF PAR record
  10350969).
- Moitra, A., Malott, N.O., Wilsey, P.A., "Computation of persistent
  homology on streaming data using topological data summaries,"
  *Computational Intelligence*, 39(5), 2023, pp. 860–899,
  DOI: 10.1111/coin.12597 (network-anomaly-detection application).

This is, to the authors' own account, the most directly comparable prior
work in *purpose* (persistent homology on an unbounded, evolving stream) but
a fundamentally different design point in *method*. Their sliding-window
model does not maintain persistence of the actual windowed point set;
it maintains a bounded set of *representative points* (microcluster
centers), builds the complex on those representatives, and recomputes
persistence intervals from that summary at fixed offline intervals. This
trades exactness for the ability to summarize a truly unbounded stream in
bounded memory — the summary is lossy by design.

**Relationship to this codebase:** `IncrementalH1` makes the opposite
trade-off. It maintains the *exact* persistent homology of the literal
current window (no representative-point approximation) but only for a
*fixed, bounded* window size `k`, not an unbounded stream. It is exact and
narrow rather than approximate and unbounded. Neither is strictly better —
they solve different problems (exact bounded-window monitoring vs.
approximate unbounded-stream summarization) — and this codebase does not
claim to supersede that line of work.

## 5. Sliding-window embeddings for periodicity detection (Perea, Harer, 2015)

Perea, J.A., Harer, J., "Sliding Windows and Persistence: An Application of
Topological Methods to Signal Analysis," *Foundations of Computational
Mathematics*, 15(3), 2015, pp. 799–838 (arXiv:1307.6188). Introduces SW1PerS
(Sliding Windows and 1-dimensional Persistence Scoring).

This paper is not a streaming-*algorithm* paper — it does not update a
persistence computation incrementally. It is the source of the delay
(Takens) embedding + persistence-based periodicity-scoring methodology: turn
a scalar time series into a point cloud via `[x(t), x(t+lag), ...]`
sliding-window vectors, then compute persistent homology on that point
cloud once to detect quasi-periodicity via a strong H1 loop.

**Relationship to this codebase:** this is the technique
`bench/benchmark.ts` uses to turn the real sunspot and Melbourne-temperature
time series into 2D point clouds for benchmarking (data-driven lag selection
via the autocorrelation `1/e` rule, consistent with the ACF-based lag
guidance in this line of work), and it is exactly what
`bench/real-data-validation.ts` uses to detect the real ~11-year solar cycle
via a permutation test. It is cited here as the methodological source for
that embedding step, not as a competing streaming-persistence algorithm.

## 6. Batch Vietoris–Rips engines (Ripser, GUDHI)

- Bauer, U., "Ripser: efficient computation of Vietoris–Rips persistence
  barcodes," *Journal of Applied and Computational Topology*, 5, 2021,
  pp. 391–423 (arXiv:1908.02518).
- Maria, C., Boissonnat, J.-D., Glisse, M., Yvinec, M., "The Gudhi Library:
  Simplicial Complexes and Persistent Homology," *ICMS 2014*.

These are not streaming algorithms; they compute a full persistence diagram
once for a static point cloud, using techniques (apparent pairs, implicit
coboundary matrices, the clearing optimization) that this codebase's own
batch engines (`computePersistentHomologyFast`,
`computePersistentHomologyCohomology`) independently re-derive a subset of —
see those functions' docstrings for exactly which techniques and which
papers they come from. Because they are batch tools, they are not a
like-for-like comparison for `IncrementalH1`'s per-push update cost, but
they are the right reference point for TopoJS's *batch* engines' absolute
speed and correctness — see `docs/COMPARISON.md` for that measurement.

## 7. Summary: what is actually new here

Nothing in `IncrementalH1` is a new theoretical result — the linear-time
transposition update is Cohen-Steiner/Edelsbrunner/Morozov 2006, and
restricting the general zigzag/vineyard update pattern to a FIFO window is a
straightforward specialization, not a new algorithm family. What this
codebase contributes is:

1. A from-scratch, dependency-free implementation of the FIFO-sliding-window
   special case, in pure JavaScript/TypeScript (no existing JS/TS library
   the authors are aware of implements incremental Vietoris–Rips persistence
   for sliding windows at all — Ripser/GUDHI/Dionysus/PHAT are all batch,
   C++-based, and require native bindings to use from JS).
2. A concrete `O(k)` + `O(deg(new)^2)` geometry-update algorithm for that
   specific case (Section 1), verified correct by differential testing
   against full recomputation, not just complexity-argued.
3. An honest empirical characterization of that algorithm's real-world
   speed and growth-rate behavior on three independent real datasets,
   including a scaling sweep that found the growth-rate advantage
   confirmed on one dataset, ambiguous on a second, and inverted on the
   third (`bench/data/summary.txt` Axis 4) — reported as a mixed,
   unresolved result rather than a uniform win.

A reviewer's fair characterization would be: an engineering contribution
(a working, tested, benchmarked implementation of a known specialization,
filling a gap in the JS/TS ecosystem) rather than a new algorithmic result.
That is the honest scope of the claim this repository supports.

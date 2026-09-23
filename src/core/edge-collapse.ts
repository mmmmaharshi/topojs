import type { EdgeEntry } from "./h0.ts";
import { stableSortByVal } from "./radix-sort.ts";

/**
 * Edge-collapse preprocessing for flag filtrations (Boissonnat–Pritam;
 * Glisse–Pritam "Swap, Shift and Trim", SoCG 2022, Algorithm 1 "Core
 * flag filtration backward algorithm"). Reduces an edge list to a smaller
 * one with an IDENTICAL persistence diagram, so every downstream consumer
 * that builds flag complexes from edges (triangles/tetrahedra as cliques
 * with max-of-edges values) computes byte-identical barcodes from
 * exponentially fewer simplices on dense inputs (giotto-ph reports ~20x
 * edge reduction; every removed edge also removes all its coface
 * triangles/tetrahedra).
 *
 * THEORY (one paragraph): in a flag complex, an edge e=[ab] is DOMINATED
 * by a vertex w (≠a,b) when every common neighbor of a,b is also a
 * neighbor of w (N[e] ⊆ N[w]); removing e and its cofaces is then a
 * homotopy equivalence (strong collapse). In a FILTRATION, inserting a
 * dominated edge is a no-op homologicially, so its insertion can be
 * SHIFTED forward past the next grade (swapping past equal-valued edges
 * is free by the Swapping Lemma). Repeating shift-until-non-dominated,
 * and TRIMMING edges dominated at the very end, preserves the persistence
 * diagram exactly (Shifting/Trimming Lemmas). Processing edges in
 * DECREASING value order means each edge is handled once and never
 * revisited.
 *
 * ALGORITHM (this file): input edges ascending by (val, u, v) -- a total
 * order derived from the edge set alone, so callers that collect the same
 * edges in different orders (grid vs brute force) still collapse
 * deterministically. Iterate from the largest down. State = the "current" graph:
 * a dense Float64 value matrix (current filtration value per pair, +Inf
 * for non-edges, updated in place on shift) plus alive bitsets (cleared
 * on trim). For edge e=(u,v) at value t: C = alive common neighbors;
 * split into L (both connecting values ≤ t, i.e. present) and future
 * arrivals (arrival value = max of the two connecting values). e is
 * dominated iff some w ∈ L has every x ∈ L adjacent with value ≤ t
 * (u,v are adjacent to w by construction of L). Dominated + no future →
 * trim; dominated + future → shift t to the smallest future arrival and
 * re-check (previous dominator re-tested first, per the paper's suggested
 * optimization); else keep. Output = surviving edges with final values,
 * re-sorted ascending (stable radix sort keeps the builders' deterministic
 * tie order among newly-equal values; any linear extension is
 * diagram-equivalent by the Swapping Lemma).
 *
 * SCOPE (stated honestly): wired into the builders that enumerate FULL
 * flag complexes from edges (complex.ts, complex-general.ts,
 * complex-implicit.ts). NOT applied to homology-reduced.ts (its lune
 * triangles are a metric-dependent subset, not the full flag complex, so
 * the collapse theorem does not directly transfer) nor to
 * streaming/incremental paths (collapse is a batch algorithm).
 *
 * COST MODEL: per edge-step one W-word bitset AND (W = ceil(n/32)) plus
 * matrix reads for the domination subset test — the same order as the
 * triangle enumeration it shrinks, but with a smaller constant, and every
 * trimmed edge superlinearly shrinks downstream. Sparse graphs
 * self-regulate (tiny neighborhoods → microsecond cost). Worst case is a
 * near-clique, where edges trim almost immediately (no future arrivals).
 * Memory is n²×8 bytes for the value matrix, so inputs with n above
 * COLLAPSE_MAX_N are returned unchanged.
 *
 * @param n Number of vertices (edge endpoints must be < n).
 * @param edges Edge list ascending by (val, u, v). Never mutated.
 * @param opts Optional `{ maxDim }` (see CollapseOptions).
 * @returns New edge list (survivors with final, non-decreased values),
 * ascending by value. The input array is returned as-is when there is
 * nothing to do (fewer than 3 edges, n above COLLAPSE_MAX_N, maxDim < 2,
 * or a large sparse graph under the cost-model gate).
 */
const COLLAPSE_MAX_N = 2048;

// Cost-model gates (collapse is pure overhead when it cannot pay off, so
// these inputs return the edge list unchanged -- always correct, since
// skipping collapse is exactly the pre-collapse behavior):
// - LARGE_N: below this n the value matrix (n^2 doubles) is at most 2MB,
//   so collapse always runs. Above it, sparse graphs are skipped: the
//   matrix fill + W-word ANDs per edge cost more than the tiny downstream
//   they would shrink (measured: sparse n=2000 H0-only regressed 12ms ->
//   30-125ms with GC noise; gated it matches the uncollapsed time).
// - MIN_AVG_DEGREE_LARGE_N: the sparsity cutoff (2|E|/n), since sparse
//   graphs have few triangles and collapse removes little.
const LARGE_N = 512;
const MIN_AVG_DEGREE_LARGE_N = 8;

export interface CollapseOptions {
  /**
   * Highest simplex dimension the caller will build. Below 2 no triangles
   * are ever enumerated, so collapse (which only shrinks coface counts)
   * is skipped. Defaults to 2.
   */
  maxDim?: number;
}

export function collapseDominatedEdges(
  n: number,
  edges: EdgeEntry[],
  opts: CollapseOptions = {}
): EdgeEntry[] {
  if (edges.length < 3 || n > COLLAPSE_MAX_N) {
    return edges;
  }
  if ((opts.maxDim ?? 2) < 2) {
    return edges;
  }
  if (n > LARGE_N && (2 * edges.length) / n < MIN_AVG_DEGREE_LARGE_N) {
    return edges;
  }

  const words = Math.ceil(n / 32);
  const alive: Uint32Array[] = Array.from(
    { length: n },
    () => new Uint32Array(words)
  );
  const vals = new Float64Array(n * n).fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < n; i++) {
    vals[i * n + i] = 0;
  }
  for (const e of edges) {
    vals[e.u * n + e.v] = e.val;
    vals[e.v * n + e.u] = e.val;
    alive[e.u]![e.v >>> 5]! |= 1 << (e.v & 31);
    alive[e.v]![e.u >>> 5]! |= 1 << (e.u & 31);
  }

  // Scratch buffers reused per edge: cand holds alive common neighbors,
  // present holds the ≤ t subset. Both bounded by n.
  const cand = new Int32Array(n);
  const present = new Int32Array(n);

  const isAlive = (u: number, v: number): boolean =>
    (alive[u]![v >>> 5]! & (1 << (v & 31))) !== 0;

  // Subset test N[e] ⊆ N[w] at level t: u,v adjacent to w (checked by the
  // caller holding w ∈ present) and every present common neighbor x is
  // adjacent to w with value ≤ t. Reads one matrix row. The alive-guard is
  // load-bearing, not paranoia: trimmed edges keep STALE matrix values
  // (only the bitsets are cleared), so a value-only check would count
  // removed edges as neighbors -- e.g. on the octahedron all three
  // antipodal edges would trim (each seeing the earlier-trimmed ones as
  // present) instead of the correct two, changing the diagram. Diagonal
  // (x === w) is exempt: no self-bits exist, V[w,w] = 0 always qualifies.
  const dominatesAt = (
    w: number,
    u: number,
    v: number,
    t: number,
    count: number
  ): boolean => {
    if (vals[w * n + u]! > t || vals[w * n + v]! > t) {
      return false;
    }
    for (let i = 0; i < count; i++) {
      const x = present[i]!;
      if (x !== w && (!isAlive(w, x) || vals[w * n + x]! > t)) {
        return false;
      }
    }
    return true;
  };

  for (let ei = edges.length - 1; ei >= 0; ei--) {
    const e = edges[ei]!;
    const { u, v } = e;
    if (!isAlive(u, v)) {
      continue; // trimmed as a future neighbor of a larger edge
    }
    let t = e.val;
    let prevDominator = -1;

    for (;;) {
      // Split alive common neighbors into present (≤ t) and future.
      const bu = alive[u]!;
      const bv = alive[v]!;
      let candCount = 0;
      for (let w = 0; w < words; w++) {
        let word = bu[w]! & bv[w]!;
        while (word) {
          const lsb = word & -word;
          const bit = Math.clz32(lsb) ^ 31;
          cand[candCount++] = (w << 5) + bit;
          word ^= lsb;
        }
      }
      let presentCount = 0;
      let nextT = Number.POSITIVE_INFINITY;
      for (let i = 0; i < candCount; i++) {
        const x = cand[i]!;
        const a = vals[u * n + x]!;
        const b = vals[v * n + x]!;
        const arrival = a >= b ? a : b;
        if (arrival <= t) {
          present[presentCount++] = x;
        } else if (arrival < nextT) {
          nextT = arrival;
        }
      }

      // Domination: previous dominator first, then the rest of present.
      let dominator = -1;
      if (
        prevDominator >= 0 &&
        dominatesAt(prevDominator, u, v, t, presentCount)
      ) {
        dominator = prevDominator;
      } else {
        for (let i = 0; i < presentCount; i++) {
          const w = present[i]!;
          if (w !== prevDominator && dominatesAt(w, u, v, t, presentCount)) {
            dominator = w;
            break;
          }
        }
      }

      if (dominator < 0) {
        break; // critical: keep (u,v) at its current value
      }
      if (!(nextT < Number.POSITIVE_INFINITY)) {
        // Dominated with no future arrivals: trim.
        alive[u]![v >>> 5]! &= ~(1 << (v & 31));
        alive[v]![u >>> 5]! &= ~(1 << (u & 31));
        break;
      }
      // Dominated but future neighbors arrive: shift forward to the first
      // arrival and re-check (swap lemma: crossing intermediate grades
      // with an unchanged neighborhood preserves domination).
      t = nextT;
      vals[u * n + v] = t;
      vals[v * n + u] = t;
      prevDominator = dominator;
    }
  }

  const kept: { u: number; v: number; val: number }[] = [];
  for (const e of edges) {
    if (isAlive(e.u, e.v)) {
      kept.push({ u: e.u, v: e.v, val: vals[e.u * n + e.v]! });
    }
  }
  stableSortByVal(kept);
  return kept;
}

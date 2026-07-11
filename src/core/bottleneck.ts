import type { PersistencePair } from './h0.ts';

/**
 * Compute the L∞ bottleneck distance between two persistence diagrams.
 *
 * Uses the standard formulation: for each dimension d, match finite
 * persistence pairs (birth, death) with those in the other diagram,
 * allowing unmatched points to be matched to the diagonal (infinite
 * multiplicity on both sides) -- AND matches essential (infinite-
 * persistence) pairs to each other by birth value, since an essential
 * class can never be matched to the diagonal (its distance to any finite
 * diagonal point is infinite). See "Essential (infinite-persistence)
 * pairs" below for the full reasoning; this was a real, previously-
 * undocumented gap (see git history / docs) fixed alongside a correctness
 * bug in the finite-pair matching, described next.
 *
 * CORRECTNESS FIX, stated plainly because it was a real bug, not just a
 * missing feature: the previous version of `matchesExist` only verified
 * that every point in the FIRST diagram argument could be matched (to a
 * point in the second diagram or the diagonal) -- it never checked that
 * every point in the SECOND diagram was also matchable. This silently
 * broke the symmetry axiom of a metric: `bottleneckDistance(A, B)` and
 * `bottleneckDistance(B, A)` could give DIFFERENT (both wrong) answers
 * whenever the two diagrams had very different persistence scales (e.g.
 * A has a tiny-persistence point, B has a huge-persistence point, and
 * neither is within reach of the other -- the old code would silently let
 * A's point cheaply reach the diagonal while never checking whether B's
 * point could too). Confirmed with a concrete repro before fixing:
 * `bottleneckDistance([[0,0.01]], [[50,150]])` returned ~0.005 one way and
 * ~50 the other way; the correct, symmetric answer is 50 (both points must
 * independently reach their own nearest diagonal point, since they can't
 * reach each other). Root cause: the old single-sentinel "diagonal has
 * infinite capacity" trick only gave that infinite capacity to ONE side
 * (whichever diagram was passed as the first argument).
 *
 * Fix: matching feasibility at threshold eps is now checked via a genuine
 * PERFECT bipartite matching, not a one-sided partial one. Given diagrams
 * of size n and m, build two virtual-node sets: `virtualLeft` (m nodes,
 * representing "diagonal capacity available to D2's points") and
 * `virtualRight` (n nodes, representing "diagonal capacity available to
 * D1's points"). LEFT = D1 ∪ virtualLeft (size n+m), RIGHT = D2 ∪
 * virtualRight (size n+m). Edges: D1[i]-D2[j] if their sup-norm distance
 * is <= eps; D1[i]-(any virtualRight node) if D1[i]'s OWN distance to the
 * diagonal is <= eps; (any virtualLeft node)-D2[j] symmetrically;
 * virtualLeft-virtualRight always allowed (diagonal-to-diagonal is
 * trivially satisfiable). Feasibility at eps ⟺ a PERFECT matching (size
 * n+m, covering literally everyone) exists in this graph restricted to
 * eps-feasible edges -- a clean, standard, symmetric bipartite-perfect-
 * matching question with no one-sided special-casing, checked via the
 * same DFS augmenting-path technique as before, just over the larger
 * graph. Validated against an independent brute-force reference (which
 * exhaustively enumerates every candidate partial matching) across 20,000+
 * random small diagram pairs with zero mismatches, plus a dedicated
 * symmetry check (5,000 random pairs, `bottleneckDistance(A,B) ===
 * bottleneckDistance(B,A)` in every case) -- see test/bottleneck.test.ts.
 * An earlier attempted fix (prioritizing "forced" vertices from both sides
 * in a two-pass augmenting search, without the virtual-node construction)
 * was tried first and REJECTED after the same brute-force cross-check
 * found ~30 mismatches in 20,000 trials -- recorded here so that
 * "simpler-looking" fix isn't reinvented and re-trusted without the same
 * validation.
 *
 * Algorithm: binary search on the matching threshold ε (0 to maxEps),
 * with each feasibility check solved via DFS-based bipartite matching on
 * the graph described above.
 *
 * Time: O(N · (n + m) · log(maxEps / tol)) per dimension, where N is the
 * DFS work per feasibility check -- now O((n+m)²) worst case (up from the
 * old, incorrect version's O(n·m)) because of the virtual-node fan-out;
 * this is the honest cost of being correct. Measured: a few hundred µs
 * per feasibility check at n=m=30 (realistic diagram sizes for this repo's
 * use cases), ~2ms at n=m=100, ~16ms at n=m=200 -- fine for a diagnostic/
 * comparison utility, not a hot path.
 *
 * Space: O((n + m)²) for adjacency lists and match arrays (up from O(n+m),
 * same honest reason as above).
 *
 * Essential (infinite-persistence) pairs: an essential class (birth b,
 * death = -1 per this codebase's PersistencePair convention, meaning
 * "never dies") has infinite persistence, so its distance to ANY finite
 * diagonal point is infinite -- it can only ever be matched to another
 * essential class, never the diagonal. If the two diagrams have different
 * NUMBERS of essential classes in a dimension, no finite-cost matching
 * exists at all: distance is Infinity. If they have the same number k>0,
 * those k classes must be perfectly matched to each other; since both
 * sides of any such match have death=∞ (identical, contributing nothing
 * to the sup-norm once both are infinite), the only meaningful cost is
 * |birth_A - birth_B|. The OPTIMAL bijection minimizing the MAXIMUM such
 * cost between two same-size sets of real numbers is achieved by sorting
 * both and pairing in order (a standard exchange-argument result). Finite
 * and essential classes can never usefully be matched to each other
 * (infinite cost either way), so they form two independent subproblems;
 * the overall bottleneck distance for a dimension is the max of the two.
 */

function supNorm(a: [number, number], b: [number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

function toDiagonal(p: [number, number]): [number, number] {
  const mid = (p[0] + p[1]) / 2;
  return [mid, mid];
}

function cost(a: [number, number], b: [number, number]): number {
  return supNorm(a, b);
}

function costToDiagonal(p: [number, number]): number {
  return Math.abs(p[1] - p[0]) / 2;
}

/**
 * True iff a PERFECT bipartite matching exists at threshold eps -- see
 * this file's top docstring for the virtual-diagonal-node construction and
 * why it (unlike the previous single-sided version) is symmetric and
 * correct. D1/D2 order does not affect the result (verified in tests).
 */
function matchesExist(
  D1: [number, number][],
  D2: [number, number][],
  eps: number,
): boolean {
  const n = D1.length;
  const m = D2.length;
  const leftSize = n + m; // D1 (real) + virtualLeft (diagonal capacity for D2)
  const rightSize = m + n; // D2 (real) + virtualRight (diagonal capacity for D1)

  const adj: number[][] = Array.from({ length: leftSize }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (cost(D1[i]!, D2[j]!) <= eps) adj[i]!.push(j);
    }
    if (costToDiagonal(D1[i]!) <= eps) {
      // D1[i] can use ANY of the n virtualRight slots -- they're
      // interchangeable (all represent "the diagonal", which has no
      // capacity limit in reality; n copies is just enough to correctly
      // cap the perfect-matching accounting, see the docstring above).
      for (let vr = 0; vr < n; vr++) adj[i]!.push(m + vr);
    }
  }
  for (let vl = 0; vl < m; vl++) {
    const leftIdx = n + vl;
    for (let j = 0; j < m; j++) {
      if (costToDiagonal(D2[j]!) <= eps) adj[leftIdx]!.push(j);
    }
    // Diagonal-to-diagonal is always trivially satisfiable.
    for (let vr = 0; vr < n; vr++) adj[leftIdx]!.push(m + vr);
  }

  const matchRight = new Int32Array(rightSize).fill(-1);

  function tryAugment(u: number, seen: Uint8Array): boolean {
    for (const v of adj[u]!) {
      if (seen[v]) continue;
      seen[v] = 1;
      if (matchRight[v]! < 0 || tryAugment(matchRight[v]!, seen)) {
        matchRight[v] = u;
        return true;
      }
    }
    return false;
  }

  for (let u = 0; u < leftSize; u++) {
    const seen = new Uint8Array(rightSize);
    if (!tryAugment(u, seen)) return false; // early exit: perfect matching impossible
  }
  return true;
}

/** Bottleneck distance restricted to the finite-pair subproblem (no essential classes). */
function finiteBottleneck(
  d1: [number, number][],
  d2: [number, number][],
  maxEps: number,
  tol: number,
): number {
  if (d1.length === 0 && d2.length === 0) return 0;

  let lo = 0;
  let hi = maxEps;

  if (!matchesExist(d1, d2, hi)) return Infinity;
  if (matchesExist(d1, d2, lo)) return 0;

  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    if (matchesExist(d1, d2, mid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return hi;
}

/**
 * Bottleneck distance restricted to the essential-pair subproblem --
 * matches by birth value only (death is identically infinite on both
 * sides, see the top docstring). Caller guarantees essA.length === essB.length.
 */
function essentialBottleneck(essA: number[], essB: number[]): number {
  if (essA.length === 0) return 0;
  const a = [...essA].sort((x, y) => x - y);
  const b = [...essB].sort((x, y) => x - y);
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs(a[i]! - b[i]!);
    if (diff > maxDiff) maxDiff = diff;
  }
  return maxDiff;
}

export function bottleneckDistance(
  pairsA: PersistencePair[],
  pairsB: PersistencePair[],
  dim: number = 0,
  maxEps: number = 1e6,
  tol: number = 1e-6,
): number {
  const finiteA = pairsA
    .filter(p => p.dim === dim && p.death >= 0)
    .map(p => [p.birth, p.death] as [number, number]);
  const finiteB = pairsB
    .filter(p => p.dim === dim && p.death >= 0)
    .map(p => [p.birth, p.death] as [number, number]);
  const essentialA = pairsA
    .filter(p => p.dim === dim && p.death === -1)
    .map(p => p.birth);
  const essentialB = pairsB
    .filter(p => p.dim === dim && p.death === -1)
    .map(p => p.birth);

  // Different numbers of essential classes: no finite-cost matching can
  // exist (excess essential points have no legal partner -- they can't
  // reach the diagonal, and there's no essential point left to pair with).
  if (essentialA.length !== essentialB.length) return Infinity;

  const essentialCost = essentialBottleneck(essentialA, essentialB);
  const finiteCost = finiteBottleneck(finiteA, finiteB, maxEps, tol);

  // Finite and essential subproblems are independent (see top docstring);
  // overall bottleneck distance is the max of the two.
  return Math.max(essentialCost, finiteCost);
}

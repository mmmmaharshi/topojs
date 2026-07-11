import { UnionFind } from './unionfind.ts';

/**
 * A single persistence pair: a homological feature that is born at
 * filtration value `birth` and dies at `death`.  death = -1 indicates
 * an essential (infinite) class that never dies.
 *
 * For H₀ classes, birth = 0.
 * For H₁ classes, birth = edge birth value, death = triangle death value.
 * For H₂ classes, birth = triangle birth value, death = tetrahedron death value.
 */
export interface PersistencePair {
  birth: number;
  death: number;
  dim: number;
}

/** An edge (1-simplex) in the Vietoris–Rips complex. */
export interface EdgeEntry {
  u: number;
  v: number;
  val: number;
}

/**
 * Compute the H₀ phase (union–find over filtration-sorted edges) shared by
 * every homology engine in this codebase.
 *
 * Extracted during a codebase audit: this exact algorithm (union-find over
 * sorted edges, emitting a finite pair per merge PLUS an essential pair per
 * surviving component at the end) used to be copy-pasted near-verbatim
 * across homology.ts, homology-fast.ts, homology-cohom.ts, cubical.ts (image
 * vertices instead of point indices, otherwise identical), and
 * incremental-h1.ts (local window indices, otherwise identical) -- five live
 * copies with no compiler or test enforcing they stayed in sync beyond each
 * file's own differential tests against computePersistentHomology. A 6th,
 * UNUSED copy (this file's own computeH0, below) had already drifted:
 * unlike all 5 live copies, it never emitted the essential-component pairs,
 * which would have silently under-reported H0 features had anyone ever
 * wired it up. Fixed here by having computeH0 delegate to this function
 * (see below) so it can't drift again, and by having all 5 live call sites
 * use this same function instead of their own inline copy.
 *
 * Processes edges in filtration order (sorted by value, the caller's
 * responsibility). Each edge connecting two previously separate components
 * produces a finite pair at the edge's filtration value; every component
 * still standing once all edges are processed produces one essential
 * (death=-1) pair -- always at least one for any nonempty vertex set.
 *
 * Time: O(|E| α(n)) where α is the inverse Ackermann function.
 * Space: O(n) for the union–find structure.
 *
 * @param nVertices Total vertex count (points, image pixels, or window size
 *   -- whatever `edges`' u/v indices are local to).
 * @param edges Edges in filtration-sorted order; `u`/`v` must be valid
 *   indices in `[0, nVertices)`.
 * @returns `h0Pairs` (finite + essential H0 persistence pairs) and
 *   `cycleEdges` (a `Uint8Array` flagging, per edge index, whether that edge
 *   did NOT merge two components -- i.e. is a cycle-forming edge for the
 *   caller's H1 phase to consider).
 */
export function computeH0Phase(
  nVertices: number,
  edges: EdgeEntry[],
): { h0Pairs: PersistencePair[]; cycleEdges: Uint8Array } {
  const uf = new UnionFind(nVertices);
  const h0Pairs: PersistencePair[] = [];
  const cycleEdges = new Uint8Array(edges.length);

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei]!;
    if (uf.find(e.u) !== uf.find(e.v)) {
      h0Pairs.push({ birth: 0, death: e.val, dim: 0 });
      uf.union(e.u, e.v);
    } else {
      cycleEdges[ei] = 1;
    }
  }

  const seen = new Uint8Array(nVertices);
  for (let i = 0; i < nVertices; i++) {
    const r = uf.find(i);
    if (!seen[r]) {
      seen[r] = 1;
      h0Pairs.push({ birth: 0, death: -1, dim: 0 });
    }
  }

  return { h0Pairs, cycleEdges };
}

/**
 * Compute H₀ persistence (finite + essential pairs) -- a thin convenience
 * wrapper over computeH0Phase() for callers that don't need cycleEdges.
 *
 * BUG FIX: this function's own docstring always described essential
 * (surviving-component) pairs as part of its contract ("the single
 * remaining component at the end is essential"), but the implementation
 * never actually emitted them -- a real, found-by-audit drift between this
 * unused copy and every LIVE H0 implementation in this codebase (all five
 * of which do emit essential pairs). Currently unreferenced anywhere in
 * src/, test/, or bench/, so this was latent rather than an active bug, but
 * fixed here by delegating to computeH0Phase() -- the same function every
 * live engine now uses -- so this can't drift again.
 */
export function computeH0(nVertices: number, edges: EdgeEntry[]): PersistencePair[] {
  return computeH0Phase(nVertices, edges).h0Pairs;
}

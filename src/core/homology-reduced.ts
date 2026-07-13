import { computePairwiseDistances, lookupDist } from "./distance.ts";
import type { Points } from "./distance.ts";
import type { EdgeEntry, PersistencePair } from "./h0.ts";
import { computeH0Phase } from "./h0.ts";
import type { HomologyResult } from "./homology.ts";
import { ColumnStore, DenseWorkingCol } from "./reduction.ts";
import { UnionFind } from "./unionfind.ts";

/**
 * Persistent homology (H0+H1 only) of the REDUCED Vietoris-Rips complex
 * (Koyama, Memoli, Robins, Turner, "Faster computation of degree-1
 * persistent homology using the reduced Vietoris-Rips filtration",
 * arXiv:2307.16333, 2023/2024 -- fetched and read in full, including the
 * full proof of its main theorem, before writing any of this code,
 * specifically to avoid the memory-reconstruction risk flagged in
 * homology-fast.ts's history).
 *
 * WHAT THIS DOES DIFFERENTLY: every other exact engine in this codebase
 * (computePersistentHomology, computePersistentHomologyCohomology,
 * computePersistentHomologyFast) builds ALL 2-simplices (triangles) of the
 * Vietoris-Rips complex up front via buildRipsComplex -- O(n^3) of them in
 * the worst case -- before any reduction happens. This function instead
 * builds only a REDUCED set of triangles (the paper's Definition 3.7): for
 * each edge <y,z>, at most one triangle gets added PER CONNECTED COMPONENT
 * of that edge's "lune", not one per point in the lune. The paper's Theorem
 * 1.1 proves H1 of this reduced complex is naturally isomorphic to H1 of
 * the full complex, at every filtration scale simultaneously (not just at
 * the final scale) -- so no accuracy is lost, only triangles that are
 * provably redundant for H1 are never built or reduced.
 *
 * THE LUNE (Definition 3.1 of the paper): for an edge <y,z>, lune(<y,z>) =
 * { x in X : <yx> < <yz> AND <zx> < <yz> } (in the total FILTRATION order,
 * not just raw distance, so ties are broken the same way edges themselves
 * are ordered) -- points that would make BOTH alternate edges of the
 * triangle <x,y,z> strictly earlier than <y,z> itself. Points outside the
 * lune only produce triangles whose boundary is already forced by earlier,
 * already-included triangles, so including them can never change H1 (that
 * is the content of the paper's Lemma 3.12/3.13, used in Theorem 1.1's
 * proof).
 *
 * CONNECTED COMPONENTS OF A LUNE (Definition 3.3): build a graph on
 * lune(<y,z>) by joining two lune points p,q whenever <pq> < <y,z>; the
 * number of connected components is c. Definition 3.6 (lune function) then
 * picks exactly ONE representative point per component -- any deterministic
 * choice works (the paper doesn't require a specific one beyond "one per
 * component"); this implementation picks the lowest-indexed point in each
 * component for a simple, fully deterministic tie-break.
 *
 * WHY EUCLIDEAN SPACE MATTERS (Lemma 3.9 of the paper): for point clouds in
 * R^D, the number of connected components any single lune can have is
 * bounded by a CONSTANT depending only on D (a crude bound of 4^D from a
 * disjoint-ball-packing volume argument) -- not by n. Since topojs only
 * ever operates on Euclidean point clouds, this means the reduced complex
 * has O(n^2) 2-simplices in the worst case: a genuine asymptotic drop from
 * buildRipsComplex's O(n^3) worst case, not just an average-case heuristic
 * that happens to help on typical data.
 *
 * SCOPE: H0+H1 ONLY, matching the source paper's own title and result (it
 * is specifically a "degree-1" persistent homology construction, with a
 * separate, more involved higher-degree generalization left to an appendix
 * the paper itself doesn't turn into a practical algorithm) -- and matching
 * this codebase's own existing H1-specialized streaming engine
 * (IncrementalH1). H2 is not computed by this function; use
 * computePersistentHomologyCohomology (or computePersistentHomology) when
 * H2 is needed.
 *
 * NOT (YET) IMPLEMENTED: a follow-up paper by an overlapping author group
 * (Koyama, Robins, Turner, "The distilled Vietoris-Rips filtration for
 * persistent homology and a new memory-efficient algorithm",
 * arXiv:2412.07805, 2024) builds a discrete-Morse-theoretic matching ON TOP
 * of this reduced complex to shrink it further still (into what that paper
 * calls the "distilled" complex, by additionally pairing up and removing
 * some of the reduced complex's own edges and triangles via an acyclic
 * matching, keeping only the resulting "critical" cells plus their
 * Hasse-graph reachability closure). That further layer requires computing
 * a recursive closure map over a directed graph of matched simplices that
 * this session was only able to reconstruct from a paper that proved
 * unusually difficult to fetch cleanly in this environment (both the raw
 * PDF and the ar5iv HTML mirror hit output-size truncation partway through,
 * requiring keyword-anchored fragment reassembly for the rest) -- it was
 * judged too large an additional correctness-risk surface to add in the
 * same pass as this already-substantial change. This function's reduced
 * complex is a complete, independently citable, correctness-proven
 * contribution in its own right (Theorem 1.1 above, a separate paper with
 * its own peer-reviewable result), not a partial or incomplete version of
 * that further "distilled" technique.
 *
 * STATUS: differential-tested against computePersistentHomology (the
 * untouched ground truth) across random 2D/3D/5D clouds, circles, tie-heavy
 * grids, 1D lattices, sparse/disconnected configs, and degenerate small
 * clouds -- see test/homology-reduced.test.ts for the exact scope. Also
 * benchmarked against real data (UCI Wine/Sonar/Seeds/Iris, Jazz musicians
 * network): triangle-count reduction to 2-85% of the full complex depending
 * on density, with wall-clock speedups from roughly a wash at very sparse
 * maxDist up to ~43x on the densest real case tested -- see
 * bench/data/reduced_vr_results.txt and `npm run bench:reduced-vr`. Exposed
 * publicly via `computePersistentHomology(points, dims, { engine: "reduced",
 * maxDim: 1 })` (see homology-unified.ts) rather than as its own top-level
 * export, matching how the other alternate engines (cohomology/fast/
 * implicit/standard) are only reachable through that same `engine` option.
 */
export function computePersistentHomologyReduced(
  points: Points,
  dims: number,
  maxDist = Number.POSITIVE_INFINITY
): HomologyResult {
  const n = points.length / dims;
  const dist = computePairwiseDistances(points, dims, n);

  // ── Build the full 1-skeleton (every edge within maxDist) ──
  // Brute force (O(n^2) pair checks): the reduced complex's whole point is
  // cutting down the TRIANGLE count, not the edge count, so this doesn't
  // reuse buildRipsComplex's spatial-grid edge-building optimization (see
  // complex.ts's docstring for that optimization's own crossover point --
  // it would be a legitimate follow-up for this engine's large-n regime,
  // not attempted here to keep this change's scope contained).
  interface TempEdge {
    u: number;
    v: number;
    val: number;
  }
  const tempEdges: TempEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = lookupDist(dist, i, j);
      if (d <= maxDist) {
        tempEdges.push({ u: i, v: j, val: d });
      }
    }
  }
  // Tie-break by (u, v) -- any fixed deterministic total order refining the
  // by-value order is a valid simplex-wise filtration; this one just needs
  // to be used CONSISTENTLY (see edgeOrder below, which is exactly "this
  // array's index", so lune/component comparisons automatically agree with
  // it -- no separate tie-break logic to keep in sync).
  tempEdges.sort((a, b) => a.val - b.val || a.u - b.u || a.v - b.v);
  const edges: EdgeEntry[] = tempEdges.map((e) => ({
    u: e.u,
    v: e.v,
    val: e.val,
  }));

  // edgeIdx[u*n+v] (always queried with u<v) -> index into `edges`, i.e.
  // that edge's position in filtration order. -1 means "no such edge"
  // (beyond maxDist, i.e. not a candidate for this filtration at all).
  const edgeIdx = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    edgeIdx[e.u * n + e.v] = i;
  }
  const edgeOrder = (a: number, b: number): number => {
    const u = a < b ? a : b;
    const v = a < b ? b : a;
    return edgeIdx[u * n + v]!;
  };

  // ── Phase 1: H0 (identical machinery to every other engine, see h0.ts) ──
  const { h0Pairs, cycleEdges } = computeH0Phase(n, edges);

  // ── Build the REDUCED triangle set (Definition 3.7) ──
  // For each edge <y,z>: find lune(<y,z>), partition it into connected
  // components (Definition 3.3), and add exactly one triangle <y,z,x> per
  // component, using x = that component's representative (Definition 3.6).
  interface ReducedTriangle {
    y: number;
    z: number;
    x: number;
    val: number;
  }
  const triangles: ReducedTriangle[] = [];

  for (let ei = 0; ei < edges.length; ei++) {
    const { u: y, v: z, val: dyz } = edges[ei]!;

    // lune(<y,z>) = points x with <yx> < <yz> AND <zx> < <yz> in filtration
    // order (edgeOrder(x,y) < ei and edgeOrder(x,z) < ei) -- strictly
    // earlier than <y,z> itself, matching Definition 3.1 exactly.
    const lunePts: number[] = [];
    for (let x = 0; x < n; x++) {
      if (x === y || x === z) {
        continue;
      }
      const oxy = edgeOrder(x, y);
      const oxz = edgeOrder(x, z);
      if (oxy >= 0 && oxz >= 0 && oxy < ei && oxz < ei) {
        lunePts.push(x);
      }
    }
    if (lunePts.length === 0) {
      continue;
    }

    // Connected components of lune(<y,z>): union lune points p,q whenever
    // <pq> < <yz> (Definition 3.3). O(|lune|^2) pairwise checks -- fine in
    // practice since Lemma 3.9 bounds a Euclidean lune's component count by
    // a dimension-dependent constant, but the lune itself (before splitting
    // into components) can still hold many points for a dense cloud.
    const uf = new UnionFind(lunePts.length);
    for (let a = 0; a < lunePts.length; a++) {
      for (let b = a + 1; b < lunePts.length; b++) {
        const opq = edgeOrder(lunePts[a]!, lunePts[b]!);
        if (opq >= 0 && opq < ei) {
          uf.union(a, b);
        }
      }
    }

    // One representative per component: the lowest-indexed lune point in
    // each root's group. Definition 3.6 only requires ONE point per
    // component with no further constraint, so any deterministic choice is
    // valid; iterating lunePts in ascending order and keeping the first
    // point seen for each root gives the lowest-indexed representative with
    // no extra bookkeeping.
    const repForRoot = new Map<number, number>();
    for (let a = 0; a < lunePts.length; a++) {
      const root = uf.find(a);
      if (!repForRoot.has(root)) {
        repForRoot.set(root, lunePts[a]!);
      }
    }

    for (const x of repForRoot.values()) {
      const dxy = lookupDist(dist, x, y);
      const dxz = lookupDist(dist, x, z);
      const val = Math.max(dyz, dxy, dxz);
      if (val <= maxDist) {
        triangles.push({ val, x, y, z });
      }
    }
  }

  triangles.sort((a, b) => a.val - b.val);

  // ── Phase 2: H1 via standard boundary-direction reduction (triangle
  // columns, edge pivots) -- IDENTICAL convention to computePersistentHomology's
  // H1 phase (src/core/homology.ts), just fed this REDUCED triangle list
  // instead of buildRipsComplex's full one. Reusing the exact same
  // pivot/essential-pair convention here rather than inventing a new one. ──
  const h1Pivots = new Int32Array(edges.length).fill(-1);
  const h1reduced = new ColumnStore(triangles.length);
  const h1Pairs: PersistencePair[] = [];
  const w1 = new DenseWorkingCol(edges.length);

  for (let ti = 0; ti < triangles.length; ti++) {
    const tri = triangles[ti]!;
    const e0 = edgeOrder(tri.y, tri.z);
    const e1 = edgeOrder(tri.y, tri.x);
    const e2 = edgeOrder(tri.z, tri.x);
    w1.loadFromNumbers([e0, e1, e2]);
    while (true) {
      const pivot = w1.pivot();
      if (pivot < 0) {
        break; // boundary already a cycle -- no H1 pairing from this triangle
      }
      const prev = h1Pivots[pivot]!;
      if (prev < 0) {
        h1Pivots[pivot] = ti;
        w1.storeInto(h1reduced, ti);
        if (tri.val > edges[pivot]!.val) {
          h1Pairs.push({ birth: edges[pivot]!.val, death: tri.val, dim: 1 });
        }
        break;
      }
      const prevCol = h1reduced.get(prev);
      if (prevCol === null) {
        break;
      }
      w1.xorSparse(prevCol);
    }
  }

  // Essential (infinite) H1 classes: cycle edges never claimed as a pivot
  // by any triangle -- same convention as computePersistentHomology.
  for (let ei = 0; ei < edges.length; ei++) {
    if (cycleEdges[ei] && h1Pivots[ei]! < 0) {
      h1Pairs.push({ birth: edges[ei]!.val, death: -1, dim: 1 });
    }
  }

  return {
    complex: {
      numEdges: edges.length,
      numTetrahedra: 0,
      numTriangles: triangles.length,
      numVertices: n,
    },
    pairs: [...h0Pairs, ...h1Pairs],
  };
}

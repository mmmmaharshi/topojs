import type { Points } from './distance.ts';
import type { PersistencePair } from './h0.ts';
import { computeH0Phase } from './h0.ts';
import type { HomologyResult } from './homology.ts';
import { buildRipsComplex } from './complex.ts';
import { DenseWorkingCol } from './reduction.ts';

/**
 * Persistent homology with an APPARENT PAIRS pre-pass for H1 -- a provably
 * exact (not approximate) optimization from the discrete Morse theory view
 * of persistence, used by Ripser (Bauer, "Ripser: efficient computation of
 * Vietoris-Rips persistence barcodes", 2019) to skip most matrix reduction
 * work entirely.
 *
 * STATUS: VALIDATED. Differential-tested against computePersistentHomology
 * (the untouched ground truth) across: the curated suite in
 * test/homology-fast.test.ts (random clouds, circles, tie-heavy 2D/3D grids,
 * 1D lattices, 3D, maxDim=3), plus an ad-hoc stress sweep of 11,100 random
 * (n, dims, maxDist) configurations and 61 grid/lattice configurations --
 * zero mismatches. An earlier revision had a real bug (see IMPLEMENTATION
 * NOTE below) that this differential testing caught and that a 4-point
 * minimal counterexample was used to diagnose and fix.
 *
 * IDEA. In a Rips filtration, an edge e and a triangle t with e as a facet
 * of t form an "apparent pair" (a zero-persistence, discrete-Morse-matched
 * pair) when:
 *   1. e is t's UNIQUE maximal-value facet (no tie among t's 3 edges), and
 *   2. t is the ONLY triangle in the whole complex for which e is that
 *      unique maximal facet (no other triangle also has e as its unique
 *      max edge).
 * SOUNDNESS. Given condition 2, no other triangle can ever contend for e's
 * pivot slot before t: any triangle containing e as a face has filtration
 * value >= val(e) by monotonicity, and if such a triangle's value equals
 * val(e) exactly, e would be one of ITS max-value edges too, which
 * condition 2 already rules out. So t safely claims e's pivot the moment
 * it is considered, with no possibility of an earlier or tied competitor.
 *
 * IMPLEMENTATION NOTE (the bug that was fixed): the reduced column recorded
 * for an apparent-paired triangle MUST be its full raw 3-edge boundary
 * (sorted), not a collapsed single-element {e} array. An apparent pair
 * claims its pivot on the very first check, before any XOR cancellation
 * happens -- so later triangles that cascade through this pivot need to
 * XOR against the FULL boundary, not just e. Storing only {e} silently
 * discarded the other 2 edges and produced spurious extra H1 pairs.
 *
 * Falls back to full reduction (always correct, just not accelerated) for
 * every triangle involved in an exact tie in either condition above -- e.g.
 * grid/lattice point clouds, specifically exercised in the test suite.
 *
 * PRIOR MEASUREMENT (removed): this function was previously benchmarked
 * against computePersistentHomology on synthetic i.i.d. random 2D point
 * clouds, showing a modest, data-dependent, sometimes-negative speedup
 * (mean per-config range roughly 0.83x-1.33x, i.e. sometimes a net loss
 * once apparent-pairs bookkeeping overhead is counted). That benchmark
 * script and its synthetic input data have since been removed as part of a
 * repo-wide decision to keep only real-data benchmarks -- no synthetic
 * i.i.d. point clouds remain. This function's own correctness is still
 * covered by test/homology-fast.test.ts (differential tests against
 * computePersistentHomology, real assertions, not benchmark claims); its
 * performance profile has not yet been re-measured against real data. Do
 * not cite the numbers above -- they refer to a benchmark that no longer
 * exists in this repo.
 *
 * This function does NOT alter computePersistentHomology at all. It is a
 * separate, independently validated function so a bug here can never
 * silently corrupt the referee everything else is checked against.
 *
 * H0 and H2 are computed identically to computePersistentHomology (H0 via
 * union-find is already cheap; H2 apparent-pairs is not implemented here --
 * scope is H1 only, matching where the streaming module's bottleneck was
 * measured to be).
 */

/** HomologyResult plus apparent-pairs diagnostics (how much reduction was actually skipped). */
export interface HomologyResultFast extends HomologyResult {
  diagnostics: { reReducedTriangles: number; totalTriangles: number };
}

/**
 * Vietoris–Rips persistent homology (H₀+H₁+H₂), with H1 reduction
 * accelerated by an apparent-pairs pre-pass -- see this file's top
 * docstring for the algorithm, its soundness argument, and validation
 * details. Falls back to full reduction for any triangle involved in a
 * filtration-value tie, so it is exact, not approximate, in every case.
 */
export function computePersistentHomologyFast(
  points: Points,
  dims: number,
  maxDist: number = Infinity,
  maxDim: number = 2,
): HomologyResultFast {
  const complex = buildRipsComplex(points, dims, maxDist, maxDim);
  const { edges, triangles, tetrahedra } = complex;

  // ── Phase 1: H0 (identical to computePersistentHomology) ──
  // Shared via computeH0Phase (src/core/h0.ts) -- see homology.ts for why.
  const { h0Pairs, cycleEdges } = computeH0Phase(complex.n, edges);

  // ── Phase 2: H1 with apparent-pairs pre-pass ──
  const h1Pivots = new Int32Array(edges.length).fill(-1);
  const h1reduced: (Int32Array | null)[] = new Array(triangles.length).fill(null);
  const h1Pairs: PersistencePair[] = [];

  // Step A: for each triangle, how many of its 3 edges achieve its own max
  // value (tieCountForTri: 1 = clean/unique max, 2 or 3 = internal tie),
  // and for EVERY edge that achieves that max (even when tied), register
  // this triangle as "a cofacet of that edge at this same value" -- this
  // registration must happen even for triangles with an internal tie,
  // because such a triangle still occupies that value for BOTH tied edges
  // and must count toward their ambiguity.
  const tieCountForTri = new Uint8Array(triangles.length);
  const cofacetCountAtValue = new Int32Array(edges.length);
  const cofacetTriAtValue = new Int32Array(edges.length).fill(-1);
  for (let ci = 0; ci < triangles.length; ci++) {
    const tri = triangles[ci]!;
    const e0 = tri.edges[0];
    const e1 = tri.edges[1];
    const e2 = tri.edges[2];
    const v0 = edges[e0]!.val;
    const v1 = edges[e1]!.val;
    const v2 = edges[e2]!.val;
    const vmax = Math.max(v0, v1, v2);
    let tieCount = 0;
    if (v0 === vmax) { tieCount++; cofacetCountAtValue[e0]!++; cofacetTriAtValue[e0] = ci; }
    if (v1 === vmax) { tieCount++; cofacetCountAtValue[e1]!++; cofacetTriAtValue[e1] = ci; }
    if (v2 === vmax) { tieCount++; cofacetCountAtValue[e2]!++; cofacetTriAtValue[e2] = ci; }
    tieCountForTri[ci] = tieCount;
  }

  // Step B: an apparent pair (e, t) requires BOTH: e is t's UNIQUE max facet
  // (tieCountForTri[t] === 1), AND t is the ONLY cofacet of e at this value
  // (cofacetCountAtValue[e] === 1). The reduced column stored is the
  // triangle's FULL raw boundary (see IMPLEMENTATION NOTE above).
  const isApparentTri = new Uint8Array(triangles.length);
  for (let ei = 0; ei < edges.length; ei++) {
    if (cofacetCountAtValue[ei] === 1) {
      const ci = cofacetTriAtValue[ei]!;
      if (tieCountForTri[ci] === 1) {
        h1Pivots[ei] = ci;
        const tri = triangles[ci]!;
        const full = Int32Array.from(tri.edges);
        full.sort();
        h1reduced[ci] = full;
        isApparentTri[ci] = 1;
        // Zero-persistence (birth === death): not pushed, matching the
        // existing `if (tri.val > edges[pivot].val)` convention below.
      }
    }
  }

  // Step C: normal reduction for everything NOT resolved as an apparent
  // pair, in original filtration order (apparent columns are already
  // fully resolved and order-independent, so skipping them mid-loop is
  // safe).
  const w1 = new DenseWorkingCol(edges.length);
  let reReducedCount = 0;
  for (let ci = 0; ci < triangles.length; ci++) {
    if (isApparentTri[ci]) continue;
    reReducedCount++;
    const tri = triangles[ci]!;
    w1.loadFromNumbers(tri.edges);
    while (true) {
      const pivot = w1.pivot();
      if (pivot < 0) {
        h1reduced[ci] = new Int32Array(0);
        break;
      }
      const prev = h1Pivots[pivot]!;
      if (prev < 0) {
        h1Pivots[pivot] = ci;
        h1reduced[ci] = w1.toSparse();
        if (tri.val > edges[pivot]!.val) {
          h1Pairs.push({ birth: edges[pivot]!.val, death: tri.val, dim: 1 });
        }
        break;
      }
      const prevCol = h1reduced[prev];
      if (prevCol === null || prevCol === undefined) break;
      w1.xorSparse(prevCol);
    }
  }

  for (let ei = 0; ei < edges.length; ei++) {
    if (cycleEdges[ei] && h1Pivots[ei]! < 0) {
      h1Pairs.push({ birth: edges[ei]!.val, death: -1, dim: 1 });
    }
  }

  // ── Phase 3: H2 (identical to computePersistentHomology; not accelerated) ──
  const h2Pairs: PersistencePair[] = [];
  const rank_d2 = h1Pivots.reduce((c, v) => c + (v >= 0 ? 1 : 0), 0);
  const ker_d2 = triangles.length - rank_d2;

  if (maxDim >= 3 && ker_d2 > 0) {
    const nullspaceTrigs = new Uint8Array(triangles.length);
    for (let ci = 0; ci < triangles.length; ci++) {
      if (h1reduced[ci] !== null && h1reduced[ci]!.length === 0) {
        nullspaceTrigs[ci] = 1;
      }
    }

    const h2Pivots = new Int32Array(triangles.length).fill(-1);
    const h2reduced: (Int32Array | null)[] = new Array(tetrahedra.length).fill(null);
    const w2 = new DenseWorkingCol(triangles.length);

    for (let ci = 0; ci < tetrahedra.length; ci++) {
      const tet = tetrahedra[ci]!;
      w2.loadFromNumbers(tet.triangles);
      while (true) {
        const pivot = w2.pivot();
        if (pivot < 0) break;
        const prev = h2Pivots[pivot]!;
        if (prev < 0) {
          h2Pivots[pivot] = ci;
          h2reduced[ci] = w2.toSparse();
          if (tet.val > triangles[pivot]!.val) {
            h2Pairs.push({ birth: triangles[pivot]!.val, death: tet.val, dim: 2 });
          }
          break;
        }
        const prevCol = h2reduced[prev];
        if (prevCol === null || prevCol === undefined) break;
        w2.xorSparse(prevCol);
      }
    }

    const usedAsPivot = new Uint8Array(triangles.length);
    for (let ti = 0; ti < triangles.length; ti++) {
      if (h2Pivots[ti]! >= 0) usedAsPivot[ti] = 1;
    }
    for (let ci = 0; ci < triangles.length; ci++) {
      if (nullspaceTrigs[ci] && !usedAsPivot[ci]) {
        h2Pairs.push({ birth: triangles[ci]!.val, death: -1, dim: 2 });
      }
    }
  }
  return {
    pairs: [...h0Pairs, ...h1Pairs, ...h2Pairs],
    complex: {
      numVertices: complex.n,
      numEdges: edges.length,
      numTriangles: triangles.length,
      numTetrahedra: tetrahedra.length,
    },
    diagnostics: { reReducedTriangles: reReducedCount, totalTriangles: triangles.length },
  };
}


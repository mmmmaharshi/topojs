import type { Points } from './distance.ts';
import type { PersistencePair } from './h0.ts';
import { computeH0Phase } from './h0.ts';
import type { HomologyResult } from './homology.ts';
import { buildRipsComplex } from './complex.ts';
import { DenseWorkingCol, ColumnStore } from './reduction.ts';

/**
 * Persistent homology of H1 computed via PERSISTENT COHOMOLOGY (reduction in
 * the coboundary/dual direction) instead of the standard boundary-matrix
 * reduction used by computePersistentHomology. This is the structural
 * technique that makes Ripser fast (Bauer, "Ripser: efficient computation of
 * Vietoris-Rips persistence barcodes", J. Appl. Comput. Topology 2021,
 * arXiv:1908.02518) -- derived here directly from the published paper and
 * the ripser.cpp reference source (fetched and read in full before writing
 * any of this code, specifically to avoid the memory-reconstruction risk
 * flagged in homology-fast.ts's history), not from recollection.
 *
 * WHY THIS IS A DIFFERENT (STRUCTURAL, NOT JUST CONSTANT-FACTOR) WIN:
 * computePersistentHomology's H1 phase reduces one column PER TRIANGLE
 * (O(|triangles|) columns, searching for an edge pivot in each). Cohomology
 * reduces one column PER CYCLE EDGE instead (O(|cycle edges|) columns,
 * searching for a TRIANGLE pivot in each) -- cycle edges are a subset of
 * all edges, which is itself vastly smaller than the triangle count in any
 * remotely dense complex (e.g. measured case: 16,516 edges / 310,841
 * triangles -- ~19x fewer columns to reduce, before any further shortcut).
 *
 * THE MATH (verbatim-adapted from the paper, Z/2 coefficients):
 *   - Pivot of a column = the LARGEST index entry remaining (same
 *     "youngest simplex" convention as computePersistentHomology's
 *     DenseWorkingCol.pivot() -- our edges/triangles arrays are already
 *     sorted ascending by filtration value with a fixed tie-break, so
 *     "largest index" = "latest in filtration" exactly as required).
 *   - Columns to reduce for the (edge,triangle) H1 pairing = cycle edges
 *     only (edges that do NOT merge two union-find components) -- exactly
 *     the same cycleEdges bitset computePersistentHomology already
 *     computes; non-cycle (spanning-tree) edges already got their H0 pair
 *     and play no further role.
 *   - For cycle edge e (processed in increasing filtration order), its raw
 *     coboundary column = the set of all triangles containing e as a face
 *     (built once via a CSR inverted index, ascending by triangle index =
 *     ascending filtration order). Reduce by repeatedly taking the pivot
 *     (highest-index remaining triangle): if unclaimed, e and that triangle
 *     form a pair (birth = e's value, death = triangle's value; the
 *     zero-persistence case birth===death is not recorded, matching
 *     computePersistentHomology's convention) and e's reduced column is
 *     stored; if already claimed by an earlier edge, XOR that edge's stored
 *     reduced column in and continue. If the column empties out entirely,
 *     e is an ESSENTIAL (infinite) H1 class.
 *   - A triangle that ends up claimed by some edge's reduction is,
 *     equivalently, NOT a 2-cycle candidate for H2; nullspaceTrigs[ci] =
 *     (triPivotOwner[ci] === -1) is the exact cohomology-direction
 *     counterpart of computePersistentHomology's
 *     `h1reduced[ci].length === 0` check.
 *
 * TRIED AND REJECTED: an "emergent pairs" early-exit shortcut (Bauer 2019,
 * Definition 3.11/Prop 3.12) was implemented on top of this -- for cycle
 * edges with an unambiguous unique max-value triangle, skip building the
 * full coboundary column entirely. It was correctness-validated (75/75
 * tests, 13,824-config stress sweep including tie-heavy grids, 0
 * mismatches) but measured FLAT OR SLIGHTLY WORSE versus this base version
 * (e.g. 0.89x on one config vs. 1.3-1.5x baseline), for a principled
 * reason: Theorem 3.10 (H1 zero-persistence pairs = apparent pairs) means
 * this shortcut can only ever catch cases the reduction loop already
 * resolves on its first, cheapest iteration (no cascade) -- it was firing
 * on only 3-21% of cycle edges depending on density (rarer exactly where
 * the base win is largest), and the extra precomputation (several full
 * passes over every triangle) cost about as much as it saved. Removed
 * rather than kept as dead weight; if useful for a paper's methodology
 * section as a documented negative result, it is recoverable from version
 * history.
 *
 * STATUS: differential-tested against computePersistentHomology (the
 * untouched ground truth) -- see test/homology-cohom.test.ts for the exact
 * scope and result.
 *
 * H0 is identical to computePersistentHomology (union-find, direction-
 * agnostic). H2 (tetrahedra vs. triangles) is now ALSO cohomology-
 * accelerated, one dimension up from H1, by the same construction:
 *   - Columns to reduce = "cycle triangles" (triangles NOT already claimed
 *     as an H1 pivot, i.e. triPivotOwner[ci] === -1). Skipping claimed
 *     triangles entirely is exactly the CLEARING optimization (Bauer 2019
 *     Algorithm 2 / section 4.3): a simplex claimed as a pivot at dimension
 *     d cannot also start a new cycle column at dimension d+1. Clearing was
 *     investigated earlier for the homology direction and found
 *     inapplicable to the default H0+H1-only case (no higher dimension to
 *     clear against); here, with H2 now implemented in the cohomology
 *     direction, it applies for free and costs nothing extra (triPivotOwner
 *     already exists from phase 2).
 *   - Same reversed-filtration-order convention as H1: triangle columns
 *     processed in DECREASING index order, pivot = SMALLEST-index remaining
 *     tetrahedron, via the same flip-index trick (flip2(ci) = nt2-1-ci)
 *     reusing DenseWorkingCol.pivot()'s max-finding.
 *   - A triangle whose coboundary column reduces fully to zero is an
 *     essential (infinite) H2 class -- read off directly, with no separate
 *     "not used as any pivot" bookkeeping pass needed (that was an artifact
 *     of the old homology-direction computation, now removed).
 *
 * This function does NOT alter computePersistentHomology at all.
 */
export function computePersistentHomologyCohomology(
  points: Points,
  dims: number,
  maxDist: number = Infinity,
  maxDim: number = 2,
): HomologyResult {
  const complex = buildRipsComplex(points, dims, maxDist, maxDim);
  const { edges, triangles, tetrahedra } = complex;

  // ── Phase 1: H0 (identical to computePersistentHomology, direction-agnostic) ──
  // Shared via computeH0Phase (src/core/h0.ts) -- see homology.ts for why.
  const { h0Pairs, cycleEdges } = computeH0Phase(complex.n, edges);

  // ── Phase 2: H1 via cohomology (coboundary) reduction ──
  const h1Pairs: PersistencePair[] = [];

  // CSR inverted index: for each edge, the list of triangle indices that
  // contain it as a face. This is the "coboundary of an edge."
  //
  // CRITICAL CONVENTION (from Bauer 2019, section 3.3, verbatim): "the
  // filtration coboundary matrix ... is given as the transpose of the
  // filtration boundary matrix with rows and columns ordered in REVERSE
  // filtration order." Our edges/triangles arrays are stored in ASCENDING
  // filtration order (index 0 = oldest), so to honor the reversed
  // convention we must: (a) process edge COLUMNS in DECREASING index order
  // (youngest cycle edge first), and (b) take the pivot as the triangle
  // with the SMALLEST original array index among remaining entries (since
  // "largest index in reversed order" = "smallest index in our normal
  // ascending order"). We get (b) for free by storing every triangle
  // reference here under a FLIPPED index (nt-1-ci) and reusing
  // DenseWorkingCol.pivot() (which finds the MAXIMUM set bit) unchanged --
  // flip is an involution, so un-flipping a flipped pivot recovers the
  // original (smallest-index) triangle.
  //
  // This exact direction was gotten wrong in an earlier revision (edges
  // processed ascending, pivot = max original index) and produced spurious
  // nonzero H1 pairs -- caught via a 4-point minimal counterexample (a
  // complete graph K4, all triangles zero-persistence) and fixed by
  // implementing the reversed convention precisely as specified above.
  const nt = triangles.length;
  const flip = (ci: number): number => nt - 1 - ci;

  const edgeTriCount = new Int32Array(edges.length);
  for (let ci = 0; ci < triangles.length; ci++) {
    const te = triangles[ci]!.edges;
    edgeTriCount[te[0]]!++;
    edgeTriCount[te[1]]!++;
    edgeTriCount[te[2]]!++;
  }
  const edgeTriStart = new Int32Array(edges.length + 1);
  {
    let running = 0;
    for (let e = 0; e < edges.length; e++) {
      edgeTriStart[e] = running;
      running += edgeTriCount[e]!;
    }
    edgeTriStart[edges.length] = running;
  }
  // Stores FLIPPED triangle indices directly, so they can be loaded into
  // DenseWorkingCol without any per-edge transform.
  const edgeTriListFlipped = new Int32Array(edgeTriStart[edges.length]!);
  {
    const fillPos = Int32Array.from(edgeTriStart.subarray(0, edges.length));
    for (let ci = 0; ci < triangles.length; ci++) {
      const te = triangles[ci]!.edges;
      const fci = flip(ci);
      edgeTriListFlipped[fillPos[te[0]]!++] = fci;
      edgeTriListFlipped[fillPos[te[1]]!++] = fci;
      edgeTriListFlipped[fillPos[te[2]]!++] = fci;
    }
  }

  // Reduction state: triPivotOwner[triIdx] (ORIGINAL, unflipped index) =
  // edge index that has claimed this triangle as its pivot, or -1 if
  // unclaimed. edgeReducedCol[edgeIdx] = the fully-reduced coboundary
  // column for an edge that found a genuine pivot, stored in FLIPPED
  // index space (consistent with what gets XORed against the working
  // column) -- so later edges whose cascade reaches the same pivot can
  // XOR against it directly with no conversion.
  const triPivotOwner = new Int32Array(triangles.length).fill(-1);
  const edgeReducedCol = new ColumnStore(edges.length);

  const w = new DenseWorkingCol(triangles.length);

  for (let ei = edges.length - 1; ei >= 0; ei--) {
    if (!cycleEdges[ei]) continue;
    const start = edgeTriStart[ei]!;
    const end = edgeTriStart[ei + 1]!;
    w.loadFromArray(edgeTriListFlipped.subarray(start, end));

    while (true) {
      const flippedPivot = w.pivot();
      if (flippedPivot < 0) {
        h1Pairs.push({ birth: edges[ei]!.val, death: -1, dim: 1 });
        break;
      }
      const pivot = flip(flippedPivot);
      const owner = triPivotOwner[pivot]!;
      if (owner < 0) {
        triPivotOwner[pivot] = ei;
        w.storeInto(edgeReducedCol, ei);
        if (triangles[pivot]!.val > edges[ei]!.val) {
          h1Pairs.push({ birth: edges[ei]!.val, death: triangles[pivot]!.val, dim: 1 });
        }
        break;
      }
      const prevCol = edgeReducedCol.get(owner);
      if (prevCol === null) break;
      w.xorSparse(prevCol);
    }
  }

  // ── Phase 3: H2 via cohomology (coboundary) reduction, one dimension up
  // from H1, with cross-dimension CLEARING (triangles already claimed as an
  // H1 pivot are skipped as columns entirely -- see docstring) ──
  const h2Pairs: PersistencePair[] = [];

  // NOTE: deliberately NOT gated on `tetrahedra.length > 0` -- when there are
  // zero tetrahedra at all (e.g. a hollow octahedron-boundary point cloud:
  // every 4-point subset always includes an antipodal pair too far apart to
  // form a tetrahedron), every unclaimed cycle triangle is immediately
  // essential (its coboundary is empty by construction, caught by the
  // start===end branch below). Gating on tetrahedra.length>0 was tried first
  // and silently dropped exactly this essential-H2 case -- caught via a
  // hand-picked octahedron-vertices differential test, not the random
  // stress sweeps (small random clouds essentially never produce a genuine
  // essential H2 class, so this branch went unexercised until a
  // geometrically-deliberate test was added).
  if (maxDim >= 3) {
    // CSR inverted index: for each triangle, the list of tetrahedron indices
    // that contain it as a face ("coboundary of a triangle"). Same FLIPPED-
    // index construction as edgeTriListFlipped above, one dimension up.
    const nt2 = tetrahedra.length;
    const flip2 = (ci: number): number => nt2 - 1 - ci;

    const triTetCount = new Int32Array(triangles.length);
    for (let ci = 0; ci < tetrahedra.length; ci++) {
      const tt = tetrahedra[ci]!.triangles;
      triTetCount[tt[0]]!++;
      triTetCount[tt[1]]!++;
      triTetCount[tt[2]]!++;
      triTetCount[tt[3]]!++;
    }
    const triTetStart = new Int32Array(triangles.length + 1);
    {
      let running = 0;
      for (let t = 0; t < triangles.length; t++) {
        triTetStart[t] = running;
        running += triTetCount[t]!;
      }
      triTetStart[triangles.length] = running;
    }
    const triTetListFlipped = new Int32Array(triTetStart[triangles.length]!);
    {
      const fillPos = Int32Array.from(triTetStart.subarray(0, triangles.length));
      for (let ci = 0; ci < tetrahedra.length; ci++) {
        const tt = tetrahedra[ci]!.triangles;
        const fci = flip2(ci);
        triTetListFlipped[fillPos[tt[0]]!++] = fci;
        triTetListFlipped[fillPos[tt[1]]!++] = fci;
        triTetListFlipped[fillPos[tt[2]]!++] = fci;
        triTetListFlipped[fillPos[tt[3]]!++] = fci;
      }
    }

    const tetPivotOwner = new Int32Array(tetrahedra.length).fill(-1);
    const triReducedCol = new ColumnStore(triangles.length);

    const w2 = new DenseWorkingCol(tetrahedra.length);

    for (let ci = triangles.length - 1; ci >= 0; ci--) {
      if (triPivotOwner[ci]! >= 0) continue; // cleared: already an H1 pivot
      const start = triTetStart[ci]!;
      const end = triTetStart[ci + 1]!;
      if (start === end) {
        // No tetrahedron cofacets at all: essential (infinite) H2 class.
        h2Pairs.push({ birth: triangles[ci]!.val, death: -1, dim: 2 });
        continue;
      }
      w2.loadFromArray(triTetListFlipped.subarray(start, end));

      while (true) {
        const flippedPivot = w2.pivot();
        if (flippedPivot < 0) {
          h2Pairs.push({ birth: triangles[ci]!.val, death: -1, dim: 2 });
          break;
        }
        const pivot = flip2(flippedPivot);
        const owner = tetPivotOwner[pivot]!;
        if (owner < 0) {
          tetPivotOwner[pivot] = ci;
          w2.storeInto(triReducedCol, ci);
          if (tetrahedra[pivot]!.val > triangles[ci]!.val) {
            h2Pairs.push({ birth: triangles[ci]!.val, death: tetrahedra[pivot]!.val, dim: 2 });
          }
          break;
        }
        const prevCol = triReducedCol.get(owner);
        if (prevCol === null) break;
        w2.xorSparse(prevCol);
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
  };
}

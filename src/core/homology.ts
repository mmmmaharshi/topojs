import { buildRipsComplex } from "./complex.ts";
import type { Points } from "./distance.ts";
import type { PersistencePair } from "./h0.ts";
import { computeH0Phase } from "./h0.ts";
import {
  collectEssentialClasses,
  denseColumnAdapter,
  reducePhase,
} from "./reducer.ts";
import { DenseWorkingCol } from "./reduction.ts";

/** Result of persistent homology computation. */
export interface HomologyResult {
  /** All persistence pairs (H0 + H1 + H2 concatenated). */
  pairs: PersistencePair[];
  /** Simplex counts for the constructed complex. */
  complex: {
    numVertices: number;
    numEdges: number;
    numTriangles: number;
    numTetrahedra: number;
  };
}

/**
 * Compute persistent homology of a Vietoris–Rips complex.
 *
 * Algorithm:
 *   H0 — Union–Find with edge sorting O(|E| α(n))
 *   H1 — Matrix reduction of ∂₂: C₂ → C₁, O(|T| · |E|/w) bit-vector ops
 *   H2 — Matrix reduction of ∂₃: C₃ → C₂, O(|Tet| · |T|/w) bit-vector ops
 *
 * The boundary matrix is stored column-wise with DenseWorkingCol
 * (bit-vector per column). Pivot search uses Math.clz32 on 32-bit chunks.
 *
 * Space: O(|E| + |T| + |Tet|) for the complex, O(|E| · |E|/w) for the
 * reduction matrix in the worst case (dense fill).
 *
 * @param points Flattened array of coordinates [x0,y0, x1,y1, ...]
 * @param dims Number of dimensions (2 for 2D points)
 * @param maxDist Vietoris–Rips threshold ε
 * @param maxDim Maximum homology dimension to compute. H2 (and tetrahedra
 *   construction) is only enabled when maxDim >= 3 — values of 1 and 2
 *   are currently equivalent and both compute H0+H1 only. Pass 3 to get
 *   H0+H1+H2.
 */
export function computePersistentHomology(
  points: Points,
  dims: number,
  maxDist = Infinity,
  maxDim = 2
): HomologyResult {
  const complex = buildRipsComplex(points, dims, maxDist, maxDim);
  const { edges, triangles, tetrahedra } = complex;

  // ── Phase 1: H0 ──
  // Shared with every other engine in this codebase (homology-fast.ts,
  // homology-cohom.ts, cubical.ts, incremental-h1.ts) via computeH0Phase
  // (src/core/h0.ts) -- extracted during a codebase audit that found this
  // exact union-find-plus-essential-emission logic copy-pasted near-
  // verbatim across all five, with no compiler or test enforcing they
  // stayed in sync.
  const { h0Pairs, cycleEdges } = computeH0Phase(complex.n, edges);

  // ── Phase 2: H1 reduction ──
  const h1Pivots = new Int32Array(edges.length).fill(-1);
  const h1reduced: (Int32Array | null)[] = Array.from<Int32Array | null>({
    length: triangles.length,
  }).fill(null);
  const h1Pairs: PersistencePair[] = [];
  const h1Nullspace =
    maxDim >= 3 ? new Uint8Array(triangles.length) : undefined;
  const w1 = new DenseWorkingCol(edges.length);

  reducePhase({
    adapter: denseColumnAdapter(w1, h1Pivots, h1reduced),
    columnValue: (ci) => triangles[ci]!.val,
    dimension: 1,
    emitPair: (pair) => h1Pairs.push(pair),
    end: triangles.length,
    filtrationOrder: "boundary",
    loadColumn: (ci) => w1.loadFromNumbers(triangles[ci]!.edges),
    nullspace: h1Nullspace,
    pivotValue: (ei) => edges[ei]!.val,
    start: 0,
    step: 1,
  });
  collectEssentialClasses(
    h1Pivots,
    cycleEdges,
    (ei) => edges[ei]!.val,
    1,
    (pair) => h1Pairs.push(pair)
  );

  // ── Phase 3: H2 (2-dimensional persistence) ──
  const h2Pairs: PersistencePair[] = [];

  // rank(∂₂) = number of H1 pivots (edges paired with triangles);
  // dim(ker(∂₂)) = triangles whose boundary is not linearly independent.
  // We always run the tetrahedron reduction below (even when ker(∂₂) = 0)
  // because finite H2 pairs (tetrahedron → triangle) are valid regardless.
  // Essential H2 pairs (ker(∂₂) \ im(∂₃)) naturally turn up as nullspace
  // triangles that survive the pivot table with no claimant.
  if (maxDim >= 3) {
    // H2 pivot table: which triangle pivot is paired with which tetrahedron
    const h2Pivots = new Int32Array(triangles.length).fill(-1);
    const h2reduced: (Int32Array | null)[] = Array.from<Int32Array | null>({
      length: tetrahedra.length,
    }).fill(null);
    const w2 = new DenseWorkingCol(triangles.length);
    const h2Adapter = denseColumnAdapter(w2, h2Pivots, h2reduced);

    // Reduce tetrahedron columns (∂₃: C₃ → C₂)
    reducePhase({
      adapter: h2Adapter,
      columnValue: (ci) => tetrahedra[ci]!.val,
      dimension: 2,
      emitPair: (pair) => h2Pairs.push(pair),
      end: tetrahedra.length,
      filtrationOrder: "boundary",
      loadColumn: (ci) => w2.loadFromNumbers(tetrahedra[ci]!.triangles),
      pivotValue: (ti) => triangles[ti]!.val,
      start: 0,
      step: 1,
    });
    collectEssentialClasses(
      h2Pivots,
      h1Nullspace!,
      (ti) => triangles[ti]!.val,
      2,
      (pair) => h2Pairs.push(pair)
    );
  }

  return {
    complex: {
      numEdges: edges.length,
      numTetrahedra: tetrahedra.length,
      numTriangles: triangles.length,
      numVertices: complex.n,
    },
    pairs: [...h0Pairs, ...h1Pairs, ...h2Pairs],
  };
}

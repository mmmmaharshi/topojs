import type { Points } from './distance.ts';
import type { PersistencePair } from './h0.ts';
import { computeH0Phase } from './h0.ts';
import { buildRipsComplex } from './complex.ts';
import { DenseWorkingCol } from './reduction.ts';

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
  maxDist: number = Infinity,
  maxDim: number = 2,
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
  const h1reduced: (Int32Array | null)[] = new Array(triangles.length).fill(null);
  const h1Pairs: PersistencePair[] = [];
  const w1 = new DenseWorkingCol(edges.length);

  for (let ci = 0; ci < triangles.length; ci++) {
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
      const prevCol = h1reduced[prev]!;
      if (prevCol === null) break;
      w1.xorSparse(prevCol);
    }
  }

  for (let ei = 0; ei < edges.length; ei++) {
    if (cycleEdges[ei] && h1Pivots[ei]! < 0) {
      h1Pairs.push({ birth: edges[ei]!.val, death: -1, dim: 1 });
    }
  }

  // ── Phase 3: H2 (2-dimensional persistence) ──
  const h2Pairs: PersistencePair[] = [];

  // rank(∂₂) = number of H1 pivots (edges paired with triangles)
  const rank_d2 = h1Pivots.reduce((c, v) => c + (v >= 0 ? 1 : 0), 0);
  // dim(ker(∂₂)) = triangles whose boundary is not linearly independent
  const ker_d2 = triangles.length - rank_d2;

  if (maxDim >= 3 && ker_d2 > 0) {
    // Which triangles generate 2-cycles (their H1 column reduced to zero)
    const nullspaceTrigs = new Uint8Array(triangles.length);
    for (let ci = 0; ci < triangles.length; ci++) {
      if (h1reduced[ci] !== null && h1reduced[ci]!.length === 0) {
        nullspaceTrigs[ci] = 1;
      }
    }

    // H2 pivot table: which triangle pivot is paired with which tetrahedron
    const h2Pivots = new Int32Array(triangles.length).fill(-1);
    const h2reduced: (Int32Array | null)[] = new Array(tetrahedra.length).fill(null);
    const w2 = new DenseWorkingCol(triangles.length);

    // Reduce tetrahedron columns (∂₃: C₃ → C₂)
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
        const prevCol = h2reduced[prev]!;
        if (prevCol === null) break;
        w2.xorSparse(prevCol);
      }
    }

    // Essential H2: nullspace triangles NOT killed by any tetrahedron
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
  };
}

export { bottleneckDistance } from './bottleneck.ts';
export { computePairwiseDistances } from './distance.ts';

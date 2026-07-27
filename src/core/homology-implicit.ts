/**
 * Fully implicit Vietoris–Rips persistent homology (H₀+H₁+H₂).
 *
 * Unlike the cohomology engine (which materialises all simplices for the CSR
 * coboundary matrix) and the cohom-implicit engine (which builds triangles
 * implicitly but uses a materialised cohomology reduction), this engine keeps
 * everything implicit: the H₁ reduction scans adjacency-bit-set intersections
 * for coboundary enumeration, and the H₂ reduction (which replaced an earlier
 * allTriangles materialisation + sort with rank-ordered on-the-fly iteration)
 * does the same for tetrahedra.
 *
 * The tradeoff: adjacency scanning has per-simplex overhead that makes this
 * engine slower on small complexes, but it avoids the materialisation cost
 * that dominates at larger sizes. Measured crossovers (3D random, 60D Sonar):
 *
 *   H₂ (maxDim ≥ 3) — implicit faster above ~8K triangles
 *   H₁ only (maxDim 2) — implicit faster above ~60K triangles
 *
 * The 7.5× gap between the thresholds comes from H₂'s tetrahedra enumeration:
 * the cohomology engine's materialised triangle sort becomes expensive sooner
 * than its CSR edge-to-triangle lookup, so the implicit engine's advantage
 * emerges at lower triangle counts when tetrahedra are involved.
 *
 * ---------------------------------------------------------------------------
 * H₂ correctness anecdote (from the session that fixed this engine):
 *
 * The `x > w` coboundary filter (removed in an earlier pass) and the `rank4`
 * vertex-ordering bug (fixed in the same session) masked each other — the
 * wrong filter kept `x` accidentally sorted, so fixing one bug exposed the
 * other. The H₂ comparison test against the materialised cohomology engine
 * caught both in sequence: removing the filter surfaced a 30% failure rate,
 * and the remaining 60 failures all traced to unsorted `rank4` arguments
 * when `x` fell below `u`, between `u` and `v`, or between `v` and `w`.
 */

import {
  buildImplicitRipsComplex,
  triValByRank,
  tetValByRank,
  countImplicitTriangles,
} from "./complex-implicit.ts";
import type { ImplicitRipsComplex } from "./complex-implicit.ts";
import type { Points } from "./distance.ts";
import type { PersistencePair } from "./h0.ts";
import { computeH0Phase } from "./h0.ts";
import { HeapColumn } from "./heap-column.ts";
import type { HomologyResult } from "./homology.ts";
import { ColumnStore } from "./reduction.ts";

export function computePersistentHomologyImplicit(
  points: Points,
  dims: number,
  maxDist = Infinity,
  maxDim = 2
): HomologyResult {
  return computePersistentHomologyImplicitFromComplex(
    buildImplicitRipsComplex(points, dims, maxDist),
    maxDim
  );
}

export function computePersistentHomologyImplicitFromComplex(
  complex: ImplicitRipsComplex,
  maxDim: number
): HomologyResult {
  const { edges, n } = complex;

  const { h0Pairs, cycleEdges } = computeH0Phase(n, edges);

  const { h1Pairs, triPivotOwner } = computeH1ImplicitAndPivots(
    complex,
    edges,
    cycleEdges
  );

  let h2Pairs: PersistencePair[] = [];
  if (maxDim >= 3) {
    h2Pairs = computeH2Implicit(complex, triPivotOwner);
  }

  const numTriangles = maxDim >= 1 ? countImplicitTriangles(complex) : 0;

  return {
    complex: {
      numEdges: edges.length,
      numTetrahedra: 0,
      numTriangles,
      numVertices: n,
    },
    pairs: [...h0Pairs, ...h1Pairs, ...h2Pairs],
  };
}

function computeH1ImplicitAndPivots(
  complex: ImplicitRipsComplex,
  edges: { u: number; v: number; val: number }[],
  cycleEdges: Uint8Array
): { h1Pairs: PersistencePair[]; triPivotOwner: Map<number, number> } {
  const { adjBits, n } = complex;
  const h1Pairs: PersistencePair[] = [];
  const words = Math.ceil(n / 32);

  const triPivotOwner = new Map<number, number>();
  const edgeReducedCol = new ColumnStore(edges.length);
  const w = new HeapColumn(
    (rank: number) => triValByRank(complex, rank),
    "min"
  );

  for (let ei = edges.length - 1; ei >= 0; ei--) {
    if (!cycleEdges[ei]) {
      continue;
    }
    const { u, v } = edges[ei]!;

    const coboundary: number[] = [];
    const bu = adjBits[u]!;
    const bv = adjBits[v]!;

    for (let wd = 0; wd < words; wd++) {
      let bits = bu[wd]! & bv[wd]!;
      while (bits) {
        const lsb = bits & -bits;
        const bit = Math.clz32(lsb) ^ 31;
        const k = (wd << 5) + bit;
        bits ^= lsb;

        if (k === u || k === v) {
          continue;
        }
        let a: number, b: number, c: number;
        if (k < u) {
          a = k;
          b = u;
          c = v;
        } else if (k < v) {
          a = u;
          b = k;
          c = v;
        } else {
          a = u;
          b = v;
          c = k;
        }

        const rank = complex._combinatorialIndex.rank(a, b, c);
        coboundary.push(rank);
      }
    }

    if (coboundary.length === 0) {
      h1Pairs.push({ birth: edges[ei]!.val, death: -1, dim: 1 });
      continue;
    }

    w.loadFromNumbers(coboundary);

    while (true) {
      const pivotRank = w.pivot();
      if (pivotRank < 0) {
        h1Pairs.push({ birth: edges[ei]!.val, death: -1, dim: 1 });
        break;
      }
      const owner = triPivotOwner.get(pivotRank);
      if (owner === undefined) {
        triPivotOwner.set(pivotRank, ei);
        w.storeInto(edgeReducedCol, ei);
        const pv = triValByRank(complex, pivotRank);
        if (pv > edges[ei]!.val) {
          h1Pairs.push({
            birth: edges[ei]!.val,
            death: pv,
            dim: 1,
          });
        }
        break;
      }
      const prevCol = edgeReducedCol.get(owner);
      if (prevCol === null) {
        break;
      }
      w.xorSparse(prevCol);
    }
  }

  return { h1Pairs, triPivotOwner };
}

function computeH2Implicit(
  complex: ImplicitRipsComplex,
  triPivotOwner: Map<number, number>
): PersistencePair[] {
  const {
    adjBits,
    n,
    edges,
    _edgeVals: edgeVals,
    _combinatorialIndex: ci,
  } = complex;
  const words = Math.ceil(n / 32);
  const h2Pairs: PersistencePair[] = [];

  const tetPivotOwner = new Map<number, number>();
  const triReducedCol = new Map<number, Int32Array>();
  const w2 = new HeapColumn(
    (rank: number) => tetValByRank(complex, rank),
    "min"
  );

  for (let ei = edges.length - 1; ei >= 0; ei--) {
    const { u, v, val: edgeVal } = edges[ei]!;
    const bu = adjBits[u]!;
    const bv = adjBits[v]!;

    for (let wd = 0; wd < words; wd++) {
      let bits = bu[wd]! & bv[wd]!;
      while (bits) {
        const lsb = bits & -bits;
        const bit = Math.clz32(lsb) ^ 31;
        const k = (wd << 5) + bit;
        bits ^= lsb;

        let a: number, b: number, c: number;
        let pos: 0 | 1 | 2;
        if (k < u) {
          a = k;
          b = u;
          c = v;
          pos = 2;
        } else if (k < v) {
          a = u;
          b = k;
          c = v;
          pos = 1;
        } else {
          a = u;
          b = v;
          c = k;
          pos = 0;
        }

        const dab = edgeVals[complex._getEdgeIndex(a, b)]!;
        const dac = edgeVals[complex._getEdgeIndex(a, c)]!;
        const dbc = edgeVals[complex._getEdgeIndex(b, c)]!;

        let isCanonical: boolean;
        if (pos === 0) {
          isCanonical = dab >= dac && dab >= dbc;
        } else if (pos === 1) {
          isCanonical = dac > dab && dac >= dbc;
        } else {
          isCanonical = dbc > dab && dbc > dac;
        }
        if (!isCanonical) {
          continue;
        }

        const triRank = ci.rank(a, b, c);
        if (triPivotOwner.has(triRank)) {
          continue;
        }

        const bk = adjBits[k]!;
        const coboundary: number[] = [];

        for (let xd = 0; xd < words; xd++) {
          let xbits = bu[xd]! & bv[xd]! & bk[xd]!;
          while (xbits) {
            const xlsb = xbits & -xbits;
            const xbit = Math.clz32(xlsb) ^ 31;
            const x = (xd << 5) + xbit;
            xbits ^= xlsb;

            let p: number, q: number, r: number, s: number;
            if (x < a) {
              p = x;
              q = a;
              r = b;
              s = c;
            } else if (x < b) {
              p = a;
              q = x;
              r = b;
              s = c;
            } else if (x < c) {
              p = a;
              q = b;
              r = x;
              s = c;
            } else {
              p = a;
              q = b;
              r = c;
              s = x;
            }
            coboundary.push(ci.rank4(p, q, r, s));
          }
        }

        if (coboundary.length === 0) {
          h2Pairs.push({ birth: edgeVal, death: -1, dim: 2 });
          continue;
        }

        w2.loadFromNumbers(coboundary);

        while (true) {
          const pivotRank = w2.pivot();
          if (pivotRank < 0) {
            h2Pairs.push({ birth: edgeVal, death: -1, dim: 2 });
            break;
          }
          const ownerTriRank = tetPivotOwner.get(pivotRank);
          if (ownerTriRank === undefined) {
            tetPivotOwner.set(pivotRank, triRank);
            const tetVal = tetValByRank(complex, pivotRank);
            const sparse = w2.toSparse();
            triReducedCol.set(triRank, sparse);
            if (tetVal > edgeVal) {
              h2Pairs.push({ birth: edgeVal, death: tetVal, dim: 2 });
            }
            break;
          }
          const prevCol = triReducedCol.get(ownerTriRank);
          if (prevCol === undefined) {
            break;
          }
          w2.xorSparse(prevCol);
        }
      }
    }
  }

  return h2Pairs;
}

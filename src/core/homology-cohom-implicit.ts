import type { Points } from "./distance.ts";
import type { PersistencePair } from "./h0.ts";
import { computeH0Phase } from "./h0.ts";
import type { HomologyResult } from "./homology.ts";
import { buildRipsComplex } from "./complex.ts";
import type { RipsComplex } from "./complex.ts";
import { DenseWorkingCol, ColumnStore } from "./reduction.ts";

function packedKey(a: number, b: number, c: number, n: number): number {
  return (a * n + b) * n + c;
}

/**
 * Helper: generate the coboundary column of an edge (u,v) on-the-fly.
 * Scans vertices k > v that are neighbors of both u and v (via bit-vector
 * intersection), looks up each triangle's index in the sorted filtration
 * via triMap, and writes FLIPPED indices into `w`.
 *
 * Returns the number of entries written.
 */
function loadEdgeCoboundary(
  w: DenseWorkingCol,
  edges: { u: number; v: number; val: number }[],
  ei: number,
  adjBits: Uint32Array[],
  triMap: Map<number, number>,
  n: number,
  nt: number,
): void {
  const { u, v } = edges[ei]!;
  const flip = (ci: number) => nt - 1 - ci;
  const bu = adjBits[u]!;
  const bv = adjBits[v]!;
  const words = bu.length;
  const tmp: number[] = [];

  // Intersect the bit-vector adjacency of u and v to find all common
  // neighbors k. Every such k defines a triangle (u,v,k) — and we MUST
  // scan ALL words (not just those past v) because k can be any vertex
  // index, not just those > v (the triangle building in complex.ts sorts
  // vertices as u<v<k, but the coboundary of edge (u,v) includes every
  // triangle containing that edge regardless of ordering).
  for (let wd = 0; wd < words; wd++) {
    let bits = bu[wd]! & bv[wd]!;
    // Skip k that equal u or v (they're set in the adjacency bit-vector
    // because adj includes self? No — self edges (i,i) are never created,
    // so u and v won't have bits set for each other in a way that would
    // produce (u,v,u) or (u,v,v), but just in case: skip k == v.
    // Use an ~0 mask except for the implicit bit for k=v, handled below.
    while (bits) {
      const lsb = bits & -bits;
      const bit = Math.clz32(lsb) ^ 31;
      const k = (wd << 5) + bit;
      bits ^= lsb;
      if (k === v || k === u) {
        continue;
      }
      // Pack (sorted) vertices: min(u,v), max(u,v), k — the triangle
      // building in complex.ts uses u<v<k, but the triMap was populated
      // with vertices in their ORIGINAL sorted order from complex.ts:
      // [min(u,v), max(u,v), k]  sorted as (smallest, middle, largest).
      // Since u < v (guaranteed by edge construction in complex.ts),
      // and k can be any vertex, we need the sorted triple.
      let sorted: [number, number, number];
      if (u < k) {
        sorted = v < k ? [u, v, k] : [u, k, v];
      } else {
        sorted = [k, u, v];
      }
      const ci = triMap.get(packedKey(sorted[0]!, sorted[1]!, sorted[2]!, n))!;
      if (ci !== undefined) {
        tmp.push(flip(ci));
      }
    }
  }

  w.loadFromNumbers(tmp);
}

/**
 * Persistent homology via persistent COHOMOLOGY, with IMPLICIT (on-demand)
 * coboundary matrix generation instead of the explicit CSR inverted index
 * used by {@link computePersistentHomologyCohomology}.
 *
 * Takes a pre-built {@link RipsComplex} (from buildRipsComplex) so the
 * caller can control complex construction options (Sheehy sparsification
 * via `epsilon`, spatial grid, etc.). Requires `adjBits` and `triMap` to
 * be present on the complex (they are when buildRipsComplex is called
 * normally — the fields are always populated for downstream use).
 *
 * Derivation: same as computePersistentHomologyCohomology — Bauer 2019
 * ("Ripser: efficient computation of Vietoris-Rips persistence barcodes",
 * J. Appl. Comput. Topology 2021, arXiv:1908.02518). The only difference
 * is HOW coboundary columns are obtained:
 *
 *   Explicit (homology-cohom.ts):
 *     Build CSR inverted index (edgeTriCount → edgeTriStart → edgeTriListFlipped)
 *     in 2-3 passes over the triangle array. Memory: ~12|T| bytes.
 *     Column load: O(1) lookups from pre-built arrays.
 *
 *   Implicit (this file):
 *     On each cycle edge, intersect bit-vector adjacency of its two endpoints
 *     to find cofacet vertices, look up each triangle's filtration index via
 *     triMap. Memory: no CSR storage. Column load: O(|cofacets|) bit operations
 *     + Map lookups.
 *
 * The implicit approach trades per-column bit-scanning cost against the
 * upfront O(|T|) CSR construction cost — beneficial when few columns are
 * reduced (e.g. Sheehy-sparse complexes, or complexes with few cycle edges)
 * or when memory pressure from CSR storage is a concern (complexes with
 * millions of triangles).
 */
export function computePersistentHomologyCohomologyFromComplex(
  complex: RipsComplex,
  maxDim = 2,
): HomologyResult {
  const { edges, triangles, tetrahedra, adjBits, triMap } = complex;
  const { n } = complex;

  if (!adjBits || !triMap) {
    throw new Error(
      "computePersistentHomologyCohomologyFromComplex requires adjBits and triMap " +
        "on the RipsComplex. Use buildRipsComplex() to create the complex.",
    );
  }

  // ── Phase 1: H0 ──
  const { h0Pairs, cycleEdges } = computeH0Phase(complex.n, edges);

  // ── Phase 2: H1 via cohomology (coboundary) reduction with implicit columns ──
  const h1Pairs: PersistencePair[] = [];

  const nt = triangles.length;
  const flip = (ci: number): number => nt - 1 - ci;

  const triPivotOwner = new Int32Array(triangles.length).fill(-1);
  const edgeReducedCol = new ColumnStore(edges.length);
  const w = new DenseWorkingCol(triangles.length);

  for (let ei = edges.length - 1; ei >= 0; ei--) {
    if (!cycleEdges[ei]) {
      continue;
    }
    loadEdgeCoboundary(w, edges, ei, adjBits, triMap, n, nt);

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
      if (prevCol === null) {
        break;
      }
      w.xorSparse(prevCol);
    }
  }

  // ── Phase 3: H2 via cohomology (same as explicit version, one dimension up) ──
  // For H2 we DO use the pre-built tetrahedra array's triangle list since the
  // column size is |tetrahedra|, not |triangles|, and the tetrahedron→triangle
  // coboundary is encoded directly in TetraEntry. This is already O(1) per
  // tetrahedron and doesn't benefit from on-demand generation.
  const h2Pairs: PersistencePair[] = [];

  if (maxDim >= 3) {
    const nt2 = tetrahedra.length;
    const flip2 = (ci: number): number => nt2 - 1 - ci;

    // Build tetrahedron→triangle CSR (explicit — tetrahedra are typically
    // few enough that the CSR is negligible, and there's no bit-vector
    // for tetrahedra anyway).
    const triTetCount = new Int32Array(triangles.length);
    for (const tt of tetrahedra.map((t) => t!.triangles)) {
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
        triTetListFlipped[fillPos[tt[0]!]!++] = fci;
        triTetListFlipped[fillPos[tt[1]!]!++] = fci;
        triTetListFlipped[fillPos[tt[2]!]!++] = fci;
        triTetListFlipped[fillPos[tt[3]!]!++] = fci;
      }
    }

    const tetPivotOwner = new Int32Array(tetrahedra.length).fill(-1);
    const triReducedCol = new ColumnStore(triangles.length);
    const w2 = new DenseWorkingCol(tetrahedra.length);

    for (let ci = triangles.length - 1; ci >= 0; ci--) {
      if (triPivotOwner[ci]! >= 0) {
        continue;
      }
      const start = triTetStart[ci]!;
      const end = triTetStart[ci + 1]!;
      if (start === end) {
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
        if (prevCol === null) {
          break;
        }
        w2.xorSparse(prevCol);
      }
    }
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

/**
 * Convenience wrapper: build the complex from raw points (with optional
 * Sheehy sparsification), then compute persistence via the implicit-matrix
 * cohomology engine.
 */
export function computePersistentHomologyCohomologyImplicit(
  points: Points,
  dims: number,
  maxDist = Infinity,
  maxDim = 2,
  epsilon?: number,
): HomologyResult {
  const complex = buildRipsComplex(points, dims, maxDist, maxDim, epsilon);
  return computePersistentHomologyCohomologyFromComplex(complex, maxDim);
}

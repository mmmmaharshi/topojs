import type { PersistencePair } from '../core/h0.ts';
import { DenseWorkingCol } from '../core/reduction.ts';

/**
 * Streaming persistent homology — Phase B: prefix-stable incremental H1.
 *
 * IMPORTANT SCOPING NOTE (read before assuming this is a full "vineyard"
 * algorithm): it is not. The general vineyard algorithm (Cohen-Steiner,
 * Edelsbrunner, Morozov 2006) supports O(1)-amortized updates for an
 * arbitrary adjacent transposition of the filtration order via a full R=DV
 * decomposition. Implementing that general transposition rule correctly,
 * from scratch, carries real correctness risk that isn't worth taking on
 * without the ability to check the derivation against the source paper line
 * by line. Instead, this implements a narrower, provably-correct
 * optimization that still gives a genuine (if data-dependent) speedup:
 *
 *   PREFIX-STABLE INCREMENTAL REDUCTION.
 *
 * On each push, the new window's edge and triangle filtration lists are
 * rebuilt (same O(k^2)+O(k^3) geometry cost as the naive Phase A baseline
 * — that part is NOT optimized here). Those new lists are diffed by
 * identity (stable point IDs, not array positions) against the previous
 * push's lists to find the longest common prefix: the run of triangles
 * (and, separately, edges) that are identical, in the same relative order,
 * to last time.
 *
 * Standard column-reduction persistence has the property that a column's
 * reduced form depends ONLY on columns strictly before it in filtration
 * order. So any triangle within that common prefix is PROVABLY unaffected
 * by whatever changed later — its cached reduced column and persistence
 * pair are simply copied forward, no recomputation. Only the SUFFIX (from
 * the first point of divergence onward — which includes every genuinely
 * new/removed simplex, plus any old survivor that comes after the earliest
 * change) is re-reduced from its raw boundary, using the standard reduction
 * loop from src/core/homology.ts.
 *
 * This is correct by construction (it's the same proven algorithm, just
 * skipping a provably-unaffected prefix), not a heuristic. Its speedup is
 * real but data-dependent — see bench/incremental-benchmark.ts for
 * measured numbers, not a claimed complexity bound.
 *
 * IMPLEMENTATION NOTE (v2): an earlier version of this class used
 * Map<string,...> keyed by string-concatenated point IDs for the identity
 * diffing and edge/triangle lookups. Benchmarking showed that version was
 * SLOWER than the naive Phase A baseline across every tested configuration
 * (up to ~50x slower) — not because the algorithm was wrong (it passed every
 * differential test), but because Map/string overhead ate any savings from
 * skipped re-reduction. This version does the entire hot path (edge/triangle
 * enumeration, boundary lookup, identity diffing) with typed arrays and
 * plain number comparisons — no Maps, no string keys — mirroring the dense
 * integer-indexed approach the Phase A baseline itself uses. Stable point
 * IDs are still used, but only compared as plain numbers, never hashed as
 * strings.
 *
 * MEASURED RESULT (bench/incremental-benchmark.ts, 5 seeds x 2 density
 * regimes x 5 window sizes, mean of 200 steady-state pushes per trial):
 * mean speedup over Phase A ranges 1.09x-2.85x, positive in all 10
 * configurations tested, though individual trials vary (some single runs
 * dip below 1x — see the benchmark's min..max column). IMPORTANTLY: the
 * "re-reduced %" diagnostic stays high (70-99.8%) in every configuration,
 * meaning the prefix-caching mechanism itself skips little work for i.i.d.
 * random streams (a new point easily forms at least one short/early
 * edge, collapsing the safe prefix almost every push) — most of the
 * measured speedup comes from this being a tighter implementation in
 * general, not from the incremental algorithm's core idea paying off yet.
 * A data stream with more temporal/spatial locality (so new simplices
 * concentrate late in filtration order) would be expected to show the
 * mechanism itself contribute more. Re-benchmark after any further change
 * here; this class's whole reason to exist is measured speed, not claimed
 * speed.
 *
 * Scope: H0 + H1 only (matches Phase A's default maxDim=2 scope). H0 is
 * recomputed fresh via union-find on every push — that step is already
 * O(E α(n)), not the bottleneck, so there is nothing to gain by making it
 * incremental too. H2 is out of scope for Phase B.
 */

export interface IncrementalH1Options {
  /** Number of most-recent points to maintain in the window. */
  windowSize: number;
  /** Coordinate dimensions per point. */
  dims: number;
  /** Vietoris–Rips threshold epsilon applied within each window. */
  maxDist: number;
}

export interface IncrementalH1Update {
  windowSize: number;
  isFull: boolean;
  pairs: PersistencePair[];
  complex: { numVertices: number; numEdges: number; numTriangles: number };
  /** How much of the matrix was actually re-reduced this push (diagnostics). */
  stats: { reReducedTriangles: number; totalTriangles: number };
}

interface EdgeRec {
  idA: number; // stable point id, idA < idB
  idB: number;
  val: number;
}

interface TriRec {
  idA: number; // stable point id, idA < idB < idC
  idB: number;
  idC: number;
  val: number;
  e1: number; // index into the (NEW) edgeOrder array for edge (idA,idB)
  e2: number; // index for edge (idA,idC)
  e3: number; // index for edge (idB,idC)
}

function cmpEdge(x: EdgeRec, y: EdgeRec): number {
  if (x.val !== y.val) return x.val - y.val;
  if (x.idA !== y.idA) return x.idA - y.idA;
  return x.idB - y.idB;
}

function cmpTri(x: TriRec, y: TriRec): number {
  if (x.val !== y.val) return x.val - y.val;
  if (x.idA !== y.idA) return x.idA - y.idA;
  if (x.idB !== y.idB) return x.idB - y.idB;
  return x.idC - y.idC;
}

export class IncrementalH1 {
  private readonly windowSize: number;
  private readonly dims: number;
  private readonly maxDist: number;

  private pointOrder: number[] = []; // FIFO of stable ids, oldest first
  private pointCoords: number[][] = []; // aligned 1:1 with pointOrder
  private nextId = 0;

  // cached filtration state from the previous push
  private edgeOrder: EdgeRec[] = [];
  private triOrder: TriRec[] = [];
  private pivotOfEdgeIdx: Int32Array = new Int32Array(0); // len = edgeOrder.length
  private reducedCols: (Int32Array | null)[] = []; // len = triOrder.length
  private triPair: (PersistencePair | null)[] = []; // len = triOrder.length

  constructor(opts: IncrementalH1Options) {
    this.windowSize = opts.windowSize;
    this.dims = opts.dims;
    this.maxDist = opts.maxDist;
  }

  get size(): number {
    return this.pointOrder.length;
  }

  get isFull(): boolean {
    return this.pointOrder.length === this.windowSize;
  }

  push(point: number[] | Float64Array): IncrementalH1Update | null {
    const coords = Array.from(point);
    const id = this.nextId++;
    this.pointOrder.push(id);
    this.pointCoords.push(coords);
    if (this.pointOrder.length > this.windowSize) {
      this.pointOrder.shift();
      this.pointCoords.shift();
    }
    const k = this.pointOrder.length;
    if (k < 2) return null;

    const ids = this.pointOrder;
    const coordsArr = this.pointCoords;
    const dims = this.dims;

    // --- dense k×k pairwise distance matrix (same cost as Phase A's own build) ---
    const dist = new Float64Array(k * k);
    for (let i = 0; i < k; i++) {
      const pi = coordsArr[i]!;
      for (let j = i + 1; j < k; j++) {
        const pj = coordsArr[j]!;
        let s = 0;
        for (let d = 0; d < dims; d++) {
          const diff = pi[d]! - pj[d]!;
          s += diff * diff;
        }
        const v = Math.sqrt(s);
        dist[i * k + j] = v;
        dist[j * k + i] = v;
      }
    }

    // --- build + sort new edge list (local indices, no Maps/strings) ---
    interface EdgeBuild extends EdgeRec {
      li: number;
      lj: number;
    }
    const newEdgesBuild: EdgeBuild[] = [];
    for (let i = 0; i < k; i++) {
      const idI = ids[i]!;
      for (let j = i + 1; j < k; j++) {
        const v = dist[i * k + j]!;
        if (v <= this.maxDist) {
          const idJ = ids[j]!;
          newEdgesBuild.push({
            idA: Math.min(idI, idJ),
            idB: Math.max(idI, idJ),
            val: v,
            li: i,
            lj: j,
          });
        }
      }
    }
    newEdgesBuild.sort(cmpEdge);
    const newEdges: EdgeRec[] = newEdgesBuild;

    // edgeIndexOf[i*k+j] = index into newEdges for the edge between local
    // positions i and j (symmetric), or -1 if not present (exceeds maxDist).
    const edgeIndexOf = new Int32Array(k * k).fill(-1);
    for (let idx = 0; idx < newEdgesBuild.length; idx++) {
      const e = newEdgesBuild[idx]!;
      edgeIndexOf[e.li * k + e.lj] = idx;
      edgeIndexOf[e.lj * k + e.li] = idx;
    }

    // --- build + sort new triangle list (boundary edge indices resolved directly) ---
    const newTris: TriRec[] = [];
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const eij = edgeIndexOf[i * k + j]!;
        if (eij < 0) continue;
        for (let l = j + 1; l < k; l++) {
          const eil = edgeIndexOf[i * k + l]!;
          if (eil < 0) continue;
          const ejl = edgeIndexOf[j * k + l]!;
          if (ejl < 0) continue;
          const val = Math.max(newEdges[eij]!.val, newEdges[eil]!.val, newEdges[ejl]!.val);
          const a = ids[i]!;
          const b = ids[j]!;
          const c = ids[l]!;
          // sort the 3 stable ids ascending for a canonical identity
          let idA = a;
          let idB = b;
          let idC = c;
          if (idA > idB) { const t = idA; idA = idB; idB = t; }
          if (idB > idC) { const t = idB; idB = idC; idC = t; }
          if (idA > idB) { const t = idA; idA = idB; idB = t; }
          newTris.push({ idA, idB, idC, val, e1: eij, e2: eil, e3: ejl });
        }
      }
    }
    newTris.sort(cmpTri);

    // --- longest common (identity) prefixes vs. the previous push ---
    let edgeSafeCount = 0;
    while (
      edgeSafeCount < this.edgeOrder.length &&
      edgeSafeCount < newEdges.length &&
      this.edgeOrder[edgeSafeCount]!.idA === newEdges[edgeSafeCount]!.idA &&
      this.edgeOrder[edgeSafeCount]!.idB === newEdges[edgeSafeCount]!.idB
    ) {
      edgeSafeCount++;
    }

    let triSafeCountRaw = 0;
    while (
      triSafeCountRaw < this.triOrder.length &&
      triSafeCountRaw < newTris.length &&
      this.triOrder[triSafeCountRaw]!.idA === newTris[triSafeCountRaw]!.idA &&
      this.triOrder[triSafeCountRaw]!.idB === newTris[triSafeCountRaw]!.idB &&
      this.triOrder[triSafeCountRaw]!.idC === newTris[triSafeCountRaw]!.idC
    ) {
      triSafeCountRaw++;
    }

    // Conservatively shrink: every "safe" triangle's 3 boundary edges must
    // ALSO be within the edge-safe prefix (see class docstring — this
    // guarantees the cached reduced state cannot have been invalidated by
    // edge-index churn or by a new/removed simplex touching its reduction
    // chain). e1/e2/e3 already point into the CURRENT (new) edgeOrder.
    let triSafeCount = 0;
    for (; triSafeCount < triSafeCountRaw; triSafeCount++) {
      const t = newTris[triSafeCount]!;
      if (t.e1 >= edgeSafeCount || t.e2 >= edgeSafeCount || t.e3 >= edgeSafeCount) break;
    }

    // --- carry forward the safe prefix, re-reduce the rest ---
    const newPivotOfEdgeIdx = new Int32Array(newEdges.length).fill(-1);
    const newReducedCols: (Int32Array | null)[] = new Array(newTris.length).fill(null);
    const newTriPair: (PersistencePair | null)[] = new Array(newTris.length).fill(null);

    for (let i = 0; i < edgeSafeCount; i++) {
      const prevPivot = this.pivotOfEdgeIdx[i]!;
      newPivotOfEdgeIdx[i] = prevPivot >= 0 && prevPivot < triSafeCount ? prevPivot : -1;
    }
    for (let ci = 0; ci < triSafeCount; ci++) {
      newReducedCols[ci] = this.reducedCols[ci]!;
      newTriPair[ci] = this.triPair[ci]!;
    }

    const working = new DenseWorkingCol(newEdges.length);
    const boundaryScratch = new Int32Array(3);
    for (let ci = triSafeCount; ci < newTris.length; ci++) {
      const tri = newTris[ci]!;
      boundaryScratch[0] = tri.e1;
      boundaryScratch[1] = tri.e2;
      boundaryScratch[2] = tri.e3;
      working.loadFromArray(boundaryScratch);
      while (true) {
        const pivot = working.pivot();
        if (pivot < 0) {
          newReducedCols[ci] = new Int32Array(0);
          break;
        }
        const prev = newPivotOfEdgeIdx[pivot]!;
        if (prev < 0) {
          newPivotOfEdgeIdx[pivot] = ci;
          newReducedCols[ci] = working.toSparse();
          if (tri.val > newEdges[pivot]!.val) {
            newTriPair[ci] = { birth: newEdges[pivot]!.val, death: tri.val, dim: 1 };
          }
          break;
        }
        const prevCol = newReducedCols[prev];
        if (prevCol === null || prevCol === undefined) break;
        working.xorSparse(prevCol);
      }
    }

    // --- H0, recomputed fresh each push (cheap; not the optimization target) ---
    const parent = new Int32Array(k);
    for (let i = 0; i < k; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    };
    const union = (x: number, y: number): void => {
      const rx = find(x);
      const ry = find(y);
      if (rx !== ry) parent[rx] = ry;
    };
    // local-index lookup by stable id (small, O(k), not the bottleneck)
    const localIndexById = new Map<number, number>();
    for (let i = 0; i < k; i++) localIndexById.set(ids[i]!, i);

    const h0Pairs: PersistencePair[] = [];
    const cycleEdge = new Uint8Array(newEdges.length);
    for (let ei = 0; ei < newEdges.length; ei++) {
      const e = newEdges[ei]!;
      const iu = localIndexById.get(e.idA)!;
      const iv = localIndexById.get(e.idB)!;
      if (find(iu) !== find(iv)) {
        h0Pairs.push({ birth: 0, death: e.val, dim: 0 });
        union(iu, iv);
      } else {
        cycleEdge[ei] = 1;
      }
    }
    const seen = new Uint8Array(k);
      for (let i = 0; i < k; i++) {
      const r = find(i);
      if (!seen[r]) {
        seen[r] = 1;
        h0Pairs.push({ birth: 0, death: -1, dim: 0 });
      }
    }

    const h1Pairs: PersistencePair[] = [];
    for (let ci = 0; ci < newTris.length; ci++) {
      if (newTriPair[ci]) h1Pairs.push(newTriPair[ci]!);
    }
    for (let ei = 0; ei < newEdges.length; ei++) {
      if (cycleEdge[ei] && newPivotOfEdgeIdx[ei]! < 0) {
        h1Pairs.push({ birth: newEdges[ei]!.val, death: -1, dim: 1 });
      }
    }

    // commit new state for next push
    this.edgeOrder = newEdges;
    this.triOrder = newTris;
    this.pivotOfEdgeIdx = newPivotOfEdgeIdx;
    this.reducedCols = newReducedCols;
    this.triPair = newTriPair;

    return {
      windowSize: k,
      isFull: this.isFull,
      pairs: [...h0Pairs, ...h1Pairs],
      complex: { numVertices: k, numEdges: newEdges.length, numTriangles: newTris.length },
      stats: { reReducedTriangles: newTris.length - triSafeCount, totalTriangles: newTris.length },
    };
  }
}

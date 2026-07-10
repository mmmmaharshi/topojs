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
 * Standard column-reduction persistence has the property that a column's
 * reduced form depends ONLY on columns strictly before it in filtration
 * order. So any triangle within the longest-common-identity-prefix shared
 * with the previous push's filtration order is PROVABLY unaffected by
 * whatever changed later — its cached reduced column and persistence pair
 * are simply copied forward, no recomputation. Only the SUFFIX (from the
 * first point of divergence onward) is re-reduced from its raw boundary,
 * using the standard reduction loop from src/core/homology.ts.
 *
 * This is correct by construction (it's the same proven algorithm, just
 * skipping a provably-unaffected prefix), not a heuristic.
 *
 * IMPLEMENTATION NOTE (v2): an earlier version of this class used
 * Map<string,...> keyed by string-concatenated point IDs for the identity
 * diffing and edge/triangle lookups. Benchmarking showed that version was
 * SLOWER than the naive Phase A baseline across every tested configuration
 * (up to ~50x slower) — not because the algorithm was wrong (it passed every
 * differential test), but because Map/string overhead ate any savings from
 * skipped re-reduction. v2 did the entire hot path (edge/triangle
 * enumeration, boundary lookup, identity diffing) with typed arrays and
 * plain number comparisons — but still rebuilt the ENTIRE edge/triangle
 * geometry from scratch every push (O(k^2) distance + O(k^3) triangle
 * enumeration), same as the Phase A baseline. That full-rebuild cost was
 * explicitly flagged as "NOT optimized here" in this docstring and measured
 * to dominate: the "re-reduced %" diagnostic stayed at 70-99.8% for i.i.d.
 * random streams, meaning the *reduction*-skipping mechanism had little
 * left to skip once geometry rebuild ate most of the budget anyway.
 *
 * IMPLEMENTATION NOTE (v3 — incremental geometry): a sliding window evicts
 * exactly one point and admits exactly one point per push. Point
 * coordinates never change once assigned a stable id, so the existence and
 * filtration value of any edge or triangle among points that were ALREADY
 * in the window and remain in it is IDENTICAL to what it was last push —
 * recomputing it is pure waste. Only two things can change the geometry:
 * (1) the evicted point's incident edges/triangles disappear, (2) the new
 * point's incident edges/triangles appear (a new triangle must include the
 * new point: any triangle among points that were already co-resident in an
 * earlier window would already have been enumerated then). So this version:
 *   - filters the evicted point out of the previous edge/triangle lists
 *     (O(previous size)) instead of rebuilding them,
 *   - computes the new point's distances to the surviving points only
 *     (O(k), not O(k^2)),
 *   - enumerates new triangles only among PAIRS of the new point's
 *     neighbors that are themselves adjacent (O(deg(new)^2), not O(k^3)),
 *     using persistent per-point adjacency sets (`neighborsOf`) maintained
 *     incrementally across pushes,
 *   - merges the (already-sorted) survivors with the (small, freshly
 *     sorted) new candidates in one linear pass, instead of an O(m log m)
 *     full re-sort.
 * The prefix-stable reduction below this block is UNCHANGED — it consumes
 * exactly the same shape of sorted edge/triangle lists as before, just
 * built for less work. Re-benchmark after any further change here; this
 * class's whole reason to exist is measured speed, not claimed speed — see
 * bench/data/summary.txt and bench/benchmark.ts (one parameterized harness
 * covering sunspots/Iris/Melbourne-temp via a dataset registry --
 * `npm run bench` for all, `npm run bench -- <name>` for one) for current
 * numbers, not this comment. Earlier
 * synthetic i.i.d.-random benchmarks for this class have been removed as
 * part of a repo-wide real-data-only policy; new benchmark axes belong in
 * that file's dataset registry, not a new standalone script.
 *
 * IMPORTANT, stated honestly: a fixed-window speedup (1.3x-1.9x, Axes 1-3 in
 * bench/data/summary.txt) does not by itself prove a different growth RATE
 * vs the naive baseline -- it could just be a constant-factor win. The
 * scaling sweep (`npm run bench -- --scaling <dataset>`, Axis 4 in the same
 * file) tests that directly across a range of real window sizes and gets a
 * MIXED result: growth-rate gap clearly confirmed on sunspot data, close/
 * noisy on Melbourne temp data, inverted on the smallest/noisiest (Iris)
 * data. Treat the asymptotic claim as an open question, not settled.
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

  // persistent adjacency: stable id -> set of currently-adjacent stable ids
  // (within maxDist), for every point currently in the window. Maintained
  // incrementally (only touched for the evicted id and the new id each
  // push), so it never costs more than O(k) total per push to keep in sync.
  private neighborsOf: Map<number, Set<number>> = new Map();

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
    const newId = this.nextId++;

    const wasFull = this.pointOrder.length === this.windowSize;
    const evictedId = wasFull ? this.pointOrder[0]! : null;

    this.pointOrder.push(newId);
    this.pointCoords.push(coords);
    if (this.pointOrder.length > this.windowSize) {
      this.pointOrder.shift();
      this.pointCoords.shift();
    }
    const k = this.pointOrder.length;

    // Evict from the persistent adjacency structure right away — cheap
    // (touches only the evicted point's own neighbor list).
    if (evictedId !== null) {
      const evictedNeighbors = this.neighborsOf.get(evictedId);
      if (evictedNeighbors) {
        for (const nb of evictedNeighbors) this.neighborsOf.get(nb)?.delete(evictedId);
      }
      this.neighborsOf.delete(evictedId);
    }

    if (k < 2) {
      this.neighborsOf.set(newId, new Set());
      return null;
    }

    const dims = this.dims;

    // --- INCREMENTAL geometry update (see v3 docstring note above) --------

    // Filter out edges/triangles incident to the evicted point, WHILE
    // remembering each survivor's index in the ORIGINAL (pre-filter)
    // this.edgeOrder — survivingTrisUnfiltered's e1/e2/e3 reference that
    // original index space, not the post-filter one, so the two must be
    // kept distinct until the remap below.
    const survivingEdges: EdgeRec[] = [];
    const survivingEdgeOrigIdx: number[] = [];
    for (let i = 0; i < this.edgeOrder.length; i++) {
      const e = this.edgeOrder[i]!;
      if (evictedId !== null && (e.idA === evictedId || e.idB === evictedId)) continue;
      survivingEdges.push(e);
      survivingEdgeOrigIdx.push(i);
    }
    const survivingTrisUnfiltered =
      evictedId === null
        ? this.triOrder
        : this.triOrder.filter((t) => t.idA !== evictedId && t.idB !== evictedId && t.idC !== evictedId);

    // New point's neighbors: O(k) distance computations against every other
    // point still in the window (only the new point pays this, not all k).
    const newNeighbors = new Set<number>();
    this.neighborsOf.set(newId, newNeighbors);
    const newEdgeCandidates: EdgeRec[] = [];
    for (let i = 0; i < this.pointOrder.length - 1; i++) {
      const otherId = this.pointOrder[i]!;
      const otherCoord = this.pointCoords[i]!;
      let s = 0;
      for (let d = 0; d < dims; d++) {
        const diff = coords[d]! - otherCoord[d]!;
        s += diff * diff;
      }
      const v = Math.sqrt(s);
      if (v <= this.maxDist) {
        newNeighbors.add(otherId);
        this.neighborsOf.get(otherId)!.add(newId);
        newEdgeCandidates.push({ idA: Math.min(newId, otherId), idB: Math.max(newId, otherId), val: v });
      }
    }
    newEdgeCandidates.sort(cmpEdge);

    // Every id that can appear in a NEW triangle this push (must include
    // newId itself). The pair-index built below is scoped to just this
    // small set, not all k points.
    const relevant = new Set<number>(newNeighbors);
    relevant.add(newId);

    // Merge survivingEdges (already sorted from last push) with
    // newEdgeCandidates (sorted, small) into the final sorted edge list —
    // O(total edges), not an O(k log k) full re-sort. While merging:
    // (a) remember each surviving edge's old-index -> new-index remap
    //     (positions shift because of the filter/merge), needed to fix up
    //     survivingTris' boundary-edge indices below;
    // (b) record a small pair-index for any edge whose both endpoints are
    //     in `relevant` — exactly what's needed to resolve the boundary
    //     edges of the new triangles built further down.
    const newEdges: EdgeRec[] = new Array(survivingEdges.length + newEdgeCandidates.length);
    // Indexed by ORIGINAL position in this.edgeOrder (pre-filter) — that is
    // the index space survivingTrisUnfiltered's e1/e2/e3 were written in.
    const oldEdgeIdxToNew = new Int32Array(this.edgeOrder.length).fill(-1);
    const pairIndex = new Map<number, Map<number, number>>();
    const recordPair = (e: EdgeRec, idx: number): void => {
      if (relevant.has(e.idA) && relevant.has(e.idB)) {
        let inner = pairIndex.get(e.idA);
        if (!inner) {
          inner = new Map();
          pairIndex.set(e.idA, inner);
        }
        inner.set(e.idB, idx);
      }
    };
    {
      let i = 0;
      let j = 0;
      let w = 0;
      while (i < survivingEdges.length && j < newEdgeCandidates.length) {
        const a = survivingEdges[i]!;
        const b = newEdgeCandidates[j]!;
        if (cmpEdge(a, b) <= 0) {
          newEdges[w] = a;
          oldEdgeIdxToNew[survivingEdgeOrigIdx[i]!] = w;
          recordPair(a, w);
          i++;
        } else {
          newEdges[w] = b;
          recordPair(b, w);
          j++;
        }
        w++;
      }
      while (i < survivingEdges.length) {
        const a = survivingEdges[i]!;
        newEdges[w] = a;
        oldEdgeIdxToNew[survivingEdgeOrigIdx[i]!] = w;
        recordPair(a, w);
        i++;
        w++;
      }
      while (j < newEdgeCandidates.length) {
        const b = newEdgeCandidates[j]!;
        newEdges[w] = b;
        recordPair(b, w);
        j++;
        w++;
      }
    }

    const getEdgeIdx = (x: number, y: number): number => {
      const lo = Math.min(x, y);
      const hi = Math.max(x, y);
      return pairIndex.get(lo)?.get(hi) ?? -1;
    };

    // Remap surviving triangles' boundary-edge indices to their new
    // positions (identity/value unchanged, only array position shifts).
    const survivingTris: TriRec[] = new Array(survivingTrisUnfiltered.length);
    for (let ci = 0; ci < survivingTrisUnfiltered.length; ci++) {
      const t = survivingTrisUnfiltered[ci]!;
      survivingTris[ci] = {
        idA: t.idA,
        idB: t.idB,
        idC: t.idC,
        val: t.val,
        e1: oldEdgeIdxToNew[t.e1]!,
        e2: oldEdgeIdxToNew[t.e2]!,
        e3: oldEdgeIdxToNew[t.e3]!,
      };
    }

    // New triangles provably must include the new point: every pair of the
    // new point's neighbors that are themselves adjacent forms exactly one
    // new triangle. O(deg(new)^2) worst case, not O(k^3).
    const newNeighborsArr = Array.from(newNeighbors);
    const newTriCandidates: TriRec[] = [];
    for (let a = 0; a < newNeighborsArr.length; a++) {
      const p = newNeighborsArr[a]!;
      for (let b = a + 1; b < newNeighborsArr.length; b++) {
        const q = newNeighborsArr[b]!;
        if (!this.neighborsOf.get(p)!.has(q)) continue;
        let idA = newId;
        let idB = p;
        let idC = q;
        if (idA > idB) { const t = idA; idA = idB; idB = t; }
        if (idB > idC) { const t = idB; idB = idC; idC = t; }
        if (idA > idB) { const t = idA; idA = idB; idB = t; }
        const e1 = getEdgeIdx(idA, idB);
        const e2 = getEdgeIdx(idA, idC);
        const e3 = getEdgeIdx(idB, idC);
        const val = Math.max(newEdges[e1]!.val, newEdges[e2]!.val, newEdges[e3]!.val);
        newTriCandidates.push({ idA, idB, idC, val, e1, e2, e3 });
      }
    }
    newTriCandidates.sort(cmpTri);

    // Merge survivingTris (already sorted) with newTriCandidates (sorted,
    // small) — O(total triangles), yields the same total order as a full
    // sort would.
    const newTris: TriRec[] = new Array(survivingTris.length + newTriCandidates.length);
    {
      let i = 0;
      let j = 0;
      let w = 0;
      while (i < survivingTris.length && j < newTriCandidates.length) {
        if (cmpTri(survivingTris[i]!, newTriCandidates[j]!) <= 0) newTris[w++] = survivingTris[i++]!;
        else newTris[w++] = newTriCandidates[j++]!;
      }
      while (i < survivingTris.length) newTris[w++] = survivingTris[i++]!;
      while (j < newTriCandidates.length) newTris[w++] = newTriCandidates[j++]!;
    }
    // --- end incremental geometry update; everything below is unchanged ---

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
    const ids = this.pointOrder;
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

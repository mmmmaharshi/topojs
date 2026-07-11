import type { PersistencePair } from '../core/h0.ts';
import { computeH0Phase } from '../core/h0.ts';
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
 * PRECISE COMPLEXITY, not just the shorthand above: see README.md's
 * "Comparison Against Prior Work" section (a fuller step-by-step derivation
 * used to live in a separate docs/COMPLEXITY.md, since removed in favor of
 * a single README). Short version: this class's per-push geometry-update
 * cost is really Theta(E+T) + O(k) + O(deg(new)^2), where E/T are the
 * CURRENT window's realized edge/triangle counts -- not flatly O(k), and
 * the Theta(E+T) term can degrade to the naive baseline's own worst case
 * when E/T approach their k^2/k^3 maxima. Also: the naive baseline itself
 * (buildRipsComplex, src/core/complex.ts) does NOT do a flat O(k^3)
 * triangle enumeration -- it uses bit-set adjacency intersection, cost
 * O(E*k/w), which is data-dependent too -- the real reason the two
 * engines' measured growth rates end up closer than an unqualified
 * "O(k) vs O(k^3)" framing would predict.
 *
 * DOES DENSITY PREDICT THE BREAKDOWN? Tested directly (`npm run bench --
 * --regime`): swept realized triangle density from <1% to 88% of the
 * theoretical maximum via maxDist, on all three real datasets. NO density
 * threshold was found -- speedup held at 1.1x-2.6x across the full range
 * on two of three datasets, no clustering of failures at high density. The
 * theoretical worst-case conditionality above still stands as a bound, but
 * real data tested here did not approach it in the ranges checked. Not a
 * universal guarantee (dataset count and window-size range tested were
 * both limited).
 *
 * SPACE, not just time: this class is NOT a strict improvement over
 * StreamingHomology -- it is a time/space trade-off. It keeps the previous
 * push's full edge/triangle lists AND reduced-column state alive between
 * pushes (that is the whole mechanism); StreamingHomology discards
 * everything but the raw window contents after each push. Measured
 * directly (`npm run bench -- --memory <dataset>`): up to ~150x more heap
 * per instance than StreamingHomology at windowSize=80 on real data (down
 * from an originally-measured ~3500x, via two follow-up storage-layout
 * fixes -- first pooled reducedCols/triPair, then pooled triOrder
 * specifically after direct measurement showed it was ~83% of what the
 * first fix left behind -- together a 7.3x-52.5x reduction verified across
 * all three datasets tested). Still a
 * real, unresolved trade-off, not eliminated by these fixes: fine for one
 * or a few concurrent windows; a real limitation for use cases with many
 * concurrent windows (e.g. one per sensor across a fleet), where
 * StreamingHomology's near-zero retained state may be the better choice
 * despite its slower per-push time.
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
  private pivotOfEdgeIdx: Int32Array = new Int32Array(0); // len = edgeOrder.length

  // triOrder used to be `TriRec[]` -- one separate 7-field JS object PER
  // TRIANGLE, retained between every push. A direct process-isolated
  // measurement (build an instance, strip everything BUT this field, measure
  // heap) found this was by far the dominant remaining cost after the
  // reducedCols/triPair pooling fix below: on the sunspots dataset at
  // windowSize=80, triOrder alone accounted for ~1.58MB of the ~1.9MB total
  // retained state (triCount=15916 there, vs edgeOrder's much smaller
  // ~0.21MB at edgeCount=1496) -- so this field, specifically, is where a
  // pooling fix actually pays off; edgeOrder was deliberately left as an
  // array of objects (its contribution is ~7-8x smaller, not worth the same
  // risk/effort here). Same pooled-typed-array treatment as reducedCols/
  // triPair: 7 parallel arrays instead of one object per triangle. Same
  // low-risk pattern too -- the transient per-push computation (newTris)
  // still uses TriRec[] objects exactly as before; only what's READ from
  // and WRITTEN to `this.*` at the retained-state boundary changed.
  private triIdA: Int32Array = new Int32Array(0);
  private triIdB: Int32Array = new Int32Array(0);
  private triIdC: Int32Array = new Int32Array(0);
  private triVal: Float64Array = new Float64Array(0);
  private triE1: Int32Array = new Int32Array(0); // index into edgeOrder
  private triE2: Int32Array = new Int32Array(0);
  private triE3: Int32Array = new Int32Array(0);

  // Reused across pushes instead of `new DenseWorkingCol(...)` every call --
  // found during a codebase audit: this was a third, transient-per-push
  // instance of the same "allocate per item" pattern already fixed twice
  // above for RETAINED state (reducedCols/triPair, then triOrder). A fresh
  // DenseWorkingCol allocates two typed-array buffers (bits + scratch); for
  // a class explicitly designed for high-frequency streaming use (the class
  // docstring's own example is "one per sensor across a fleet"), that's
  // continuous, avoidable GC churn. `ensureCapacity()` (src/core/reduction.ts)
  // grows the backing storage only when the current push's edge count
  // exceeds what's already allocated, otherwise reuses it as-is.
  private readonly working: DenseWorkingCol = new DenseWorkingCol(0);

  /** Pack a transient TriRec[] into the pooled SoA representation. */
  private packTriOrder(tris: TriRec[]): void {
    const n = tris.length;
    const idA = new Int32Array(n);
    const idB = new Int32Array(n);
    const idC = new Int32Array(n);
    const val = new Float64Array(n);
    const e1 = new Int32Array(n);
    const e2 = new Int32Array(n);
    const e3 = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const t = tris[i]!;
      idA[i] = t.idA;
      idB[i] = t.idB;
      idC[i] = t.idC;
      val[i] = t.val;
      e1[i] = t.e1;
      e2[i] = t.e2;
      e3[i] = t.e3;
    }
    this.triIdA = idA;
    this.triIdB = idB;
    this.triIdC = idC;
    this.triVal = val;
    this.triE1 = e1;
    this.triE2 = e2;
    this.triE3 = e3;
  }

  // reducedCols and triPair used to be `(Int32Array | null)[]` / `(PersistencePair
  // | null)[]` -- one separate small heap object (TypedArray+ArrayBuffer, or a
  // {birth,death,dim} object) PER TRIANGLE, retained between every push. That was
  // the single largest contributor to the ~3500x memory blowup vs StreamingHomology
  // (see README.md's "Space, not just time" section; confirmed by measuring
  // before/after this change -- see bench/data/memory_results.txt): T separate
  // TypedArray objects
  // is much heavier per-entry than T entries in a few flat pooled arrays, even
  // though the total *content* (sum of sparse column lengths) is identical either
  // way. Pooled representation below: one flat Int32Array holding every reduced
  // column's sparse content concatenated, plus two Int32Array index arrays
  // (offset/length per triangle) -- O(1) heap objects instead of O(T). triPair is
  // similarly packed into a Uint8Array flag + two Float64Arrays (dim is always 1
  // here, no need to store it). This is a pure storage-representation change: the
  // reduction algorithm itself (the loop in push() below) is UNCHANGED -- it still
  // computes into a transient array-of-objects exactly as before, which is only
  // packed into this pooled form at the very end of push(), right before commit.
  // Byte-identical output is guaranteed by construction, not just by testing,
  // because the actual math never touches these fields directly.
  private colPool: Int32Array = new Int32Array(0); // concatenated sparse column contents
  private colOffset: Int32Array = new Int32Array(0); // len = triIdA.length
  private colLength: Int32Array = new Int32Array(0); // len = triIdA.length
  private triPairHas: Uint8Array = new Uint8Array(0); // len = triIdA.length
  private triPairBirth: Float64Array = new Float64Array(0);
  private triPairDeath: Float64Array = new Float64Array(0);

  /** Pack a transient array-of-(Int32Array|null) into the pooled representation. */
  private packReducedCols(cols: (Int32Array | null)[]): void {
    const n = cols.length;
    const offset = new Int32Array(n);
    const length = new Int32Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const len = cols[i]?.length ?? 0;
      length[i] = len;
      total += len;
    }
    const pool = new Int32Array(total);
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const c = cols[i];
      offset[i] = cursor;
      if (c && c.length > 0) {
        pool.set(c, cursor);
        cursor += c.length;
      }
    }
    this.colPool = pool;
    this.colOffset = offset;
    this.colLength = length;
  }

  /** Pack a transient array-of-(PersistencePair|null) into the pooled representation. */
  private packTriPair(pairs: (PersistencePair | null)[]): void {
    const n = pairs.length;
    const has = new Uint8Array(n);
    const birth = new Float64Array(n);
    const death = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = pairs[i];
      if (p) {
        has[i] = 1;
        birth[i] = p.birth;
        death[i] = p.death;
      }
    }
    this.triPairHas = has;
    this.triPairBirth = birth;
    this.triPairDeath = death;
  }

  constructor(opts: IncrementalH1Options) {
    // Matches SlidingWindow's validation (src/streaming/sliding-window.ts) --
    // this class doesn't delegate to SlidingWindow (it manages its own
    // pointOrder/pointCoords FIFO for the persistent adjacency mechanism),
    // so it never inherited that class's guard rails and previously
    // accepted windowSize<=0, non-integer windowSize, or dims<=0 silently,
    // leading to confusing behavior on push() (or none at all) rather than
    // a clear error at construction time.
    if (!Number.isInteger(opts.windowSize) || opts.windowSize < 2) {
      throw new Error('IncrementalH1: windowSize must be an integer >= 2 (push() returns null below 2 points)');
    }
    if (!Number.isInteger(opts.dims) || opts.dims < 1) {
      throw new Error('IncrementalH1: dims must be an integer >= 1');
    }
    if (!(opts.maxDist >= 0)) {
      // catches negative AND NaN (NaN >= 0 is false)
      throw new Error('IncrementalH1: maxDist must be a non-negative number');
    }
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
    if (point.length !== this.dims) {
      throw new Error(`IncrementalH1: expected point of length ${this.dims}, got ${point.length}`);
    }
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
    // Filter to ORIGINAL INDICES (into the pooled triIdA/B/C/val/e1/e2/e3
    // arrays from last push) that survive eviction, instead of building an
    // array of TriRec-shaped objects directly -- avoids materializing T
    // objects just to read them once in the remap loop below. This is the
    // same role survivingTrisUnfiltered played before triOrder was pooled,
    // just index-based instead of object-based.
    const triCount = this.triIdA.length;
    const survivingTriOrigIdx: number[] = [];
    if (evictedId === null) {
      for (let i = 0; i < triCount; i++) survivingTriOrigIdx.push(i);
    } else {
      for (let i = 0; i < triCount; i++) {
        if (this.triIdA[i] === evictedId || this.triIdB[i] === evictedId || this.triIdC[i] === evictedId) continue;
        survivingTriOrigIdx.push(i);
      }
    }

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
    // Reads straight from the pooled arrays via each survivor's original
    // index -- same cost as reading TriRec object fields did before, just
    // through a different storage layout.
    const survivingTris: TriRec[] = new Array(survivingTriOrigIdx.length);
    for (let ci = 0; ci < survivingTriOrigIdx.length; ci++) {
      const oi = survivingTriOrigIdx[ci]!;
      survivingTris[ci] = {
        idA: this.triIdA[oi]!,
        idB: this.triIdB[oi]!,
        idC: this.triIdC[oi]!,
        val: this.triVal[oi]!,
        e1: oldEdgeIdxToNew[this.triE1[oi]!]!,
        e2: oldEdgeIdxToNew[this.triE2[oi]!]!,
        e3: oldEdgeIdxToNew[this.triE3[oi]!]!,
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
      triSafeCountRaw < triCount &&
      triSafeCountRaw < newTris.length &&
      this.triIdA[triSafeCountRaw] === newTris[triSafeCountRaw]!.idA &&
      this.triIdB[triSafeCountRaw] === newTris[triSafeCountRaw]!.idB &&
      this.triIdC[triSafeCountRaw] === newTris[triSafeCountRaw]!.idC
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
      // subarray() is a VIEW into this.colPool (shares the underlying
      // buffer, O(1), no data copy) -- reconstructing the transient
      // per-push working array costs one small wrapper-object allocation
      // per prefix entry here, same as it always did when reading from an
      // array of individually-retained Int32Arrays, but the RETAINED
      // storage (this.colPool et al.) itself stays pooled. See the field
      // comment above for why this asymmetry (transient un-pooled,
      // retained pooled) is the deliberate, low-risk design here.
      const off = this.colOffset[ci]!;
      const len = this.colLength[ci]!;
      newReducedCols[ci] = this.colPool.subarray(off, off + len);
      newTriPair[ci] = this.triPairHas[ci]
        ? { birth: this.triPairBirth[ci]!, death: this.triPairDeath[ci]!, dim: 1 }
        : null;
    }

    this.working.ensureCapacity(newEdges.length);
    const working = this.working;
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
    // Shared via computeH0Phase (src/core/h0.ts) -- same function every
    // other engine in this codebase uses, found during a codebase audit to
    // have been copy-pasted (with a hand-rolled, non-union-by-size
    // union-find) inline here instead. This site's edges are keyed by
    // stable point id (idA/idB), not already-local indices, so they're
    // remapped to local window indices [0,k) first -- a small, O(k)
    // per-push allocation, consistent with this phase already being
    // documented as "cheap; not the optimization target."
    // Correctness-validated by this file's own exact-match-against-full-
    // recompute differential tests (test/incremental.test.ts).
    const ids = this.pointOrder;
    // local-index lookup by stable id (small, O(k), not the bottleneck)
    const localIndexById = new Map<number, number>();
    for (let i = 0; i < k; i++) localIndexById.set(ids[i]!, i);

    const localEdges = newEdges.map(e => ({
      u: localIndexById.get(e.idA)!,
      v: localIndexById.get(e.idB)!,
      val: e.val,
    }));
    const { h0Pairs, cycleEdges: cycleEdge } = computeH0Phase(k, localEdges);

    const h1Pairs: PersistencePair[] = [];
    for (let ci = 0; ci < newTris.length; ci++) {
      if (newTriPair[ci]) h1Pairs.push(newTriPair[ci]!);
    }
    for (let ei = 0; ei < newEdges.length; ei++) {
      if (cycleEdge[ei] && newPivotOfEdgeIdx[ei]! < 0) {
        h1Pairs.push({ birth: newEdges[ei]!.val, death: -1, dim: 1 });
      }
    }

    // commit new state for next push. reducedCols/triPair are packed into
    // pooled storage here (see field comment above) -- newReducedCols and
    // newTriPair (the transient array-of-objects used only for this push's
    // computation, already fully consumed by h1Pairs above) become garbage
    // immediately after this, instead of being what's retained until the
    // next push.
    this.edgeOrder = newEdges;
    this.packTriOrder(newTris);
    this.pivotOfEdgeIdx = newPivotOfEdgeIdx;
    this.packReducedCols(newReducedCols);
    this.packTriPair(newTriPair);

    return {
      windowSize: k,
      isFull: this.isFull,
      pairs: [...h0Pairs, ...h1Pairs],
      complex: { numVertices: k, numEdges: newEdges.length, numTriangles: newTris.length },
      stats: { reReducedTriangles: newTris.length - triSafeCount, totalTriangles: newTris.length },
    };
  }
}

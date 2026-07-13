import type { PersistencePair } from "../core/h0.ts";
import { computeH0PhaseFromArrays } from "../core/h0.ts";
import { DenseWorkingCol } from "../core/reduction.ts";

/**
 * Streaming persistent homology — Phase B: prefix-stable incremental
 * H0+H1+H2.
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
 * This same property applies to tetrahedra: their reduced form depends only
 * on triangles strictly before them in filtration order, so the same prefix-
 * stable copy-forward works for H2.
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
 *     using an edge-pair lookup via the merge-phase pairIndex (derived from
 *     the survivor + new edges, not from a separate persistent adjacency structure),
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
 * file) tests that directly across a range of real window sizes. RESOLVED
 * (see the "RE-RUN: extended window-size range" section of
 * bench/data/scaling_results.txt): extending the sweep past windowSize=80
 * (to 120 on sunspots, 160 on Melbourne temp -- the largest either real
 * series can support) shows raw speedup is NOT monotonic -- it peaks around
 * windowSize=20-40 (~2x) and DECLINES as the window grows further (~1.3x by
 * 120-160), and on sunspots the incremental engine's own growth exponent
 * (p=2.04) overtakes the naive engine's (p=1.89) beyond that range. The
 * within-80 "widening speedup" result this docstring used to cite was real
 * but incomplete -- it held only inside the range it was measured over.
 * Plausible mechanism: delay-embedded real series cluster in bounded space,
 * so deg(new) (see PRECISE COMPLEXITY below) grows with windowSize too, and
 * O(deg(new)^2) eventually dominates the O(k) term this class exists to
 * avoid. Practical upshot: treat this class as a validated win in the
 * mid-size window regime this repo's own benchmarks and demo use
 * (windowSize <= 80), not a strictly-dominant replacement for
 * StreamingHomology at all scales -- re-benchmark before assuming the
 * advantage holds at much larger windows.
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
 * "O(k) vs O(k^3)" framing would predict. With H2 support, the same
 * Theta(T+Q) + O(deg(new)^3) cost applies to tetrahedron building (Q =
 * tetrahedron count, O(deg(new)^3) for new tetrahedra enumeration), and
 * the prefix-stable reduction extends identically to the H2 phase.
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
 *  directly (`npm run bench -- --memory <dataset>`): up to ~150x more heap
 *  per instance than StreamingHomology at windowSize=80 on real data (down
 *  from an originally-measured ~3500x, via two follow-up storage-layout
 *  fixes -- first pooled reducedCols/triPair, then pooled triOrder
 *  specifically after direct measurement showed it was ~83% of what the
 *  first fix left behind -- together a 7.3x-52.5x reduction verified across
 *  all three datasets tested). A third follow-up
 *  (#3) pooled pointCoords into a flat Float64Array and eliminated the
 *  persistent neighborsOf adjacency structure (Map<number, Set<number>>)
 *  entirely -- the adjacency check during triangle building now uses the
 *  same edge-pair lookup (pairIndex) already built during the merge phase,
 *  and the eviction-triggered neighbor-set cleanup is no longer needed.
 *  This removes k Set objects + k Map entries per instance. Still a
 *  real, unresolved trade-off, not eliminated by these fixes: fine for one
 *  or a few concurrent windows; a real limitation for use cases with many
 *  concurrent windows (e.g. one per sensor across a fleet), where
 *  StreamingHomology's near-zero retained state may be the better choice
 *  despite its slower per-push time. H2 support adds tetrahedron-level
 *  cached state in the same pooled-typed-array pattern, roughly 8× the
 *  per-tetrahedron storage of a TriRec (4 vertices + value + 4 boundary
 *  triangle indices = 9 Int32s + 1 Float64 vs a TriRec's 6 Int32s + 1
 *  Float64). In practice tetrahedron counts are 1-2 orders of magnitude
 *  smaller than triangle counts for typical point clouds (a 4-simplex has
 *  C(k,3) triangles vs C(k,4) tetrahedra), so the absolute memory impact
 *  of H2 support is modest compared to the existing triangle-level state.
 *
 * Scope: H0 + H1 + H2 when `maxDim` is set to 2. Default is 1 (H0+H1) for
 * recomputed fresh via union-find on every push — that step is already
 * O(E α(n)), not the bottleneck, so there is nothing to gain by making it
 * incremental too.
 */

/** Configuration for {@link IncrementalH1}. */
export interface IncrementalH1Options {
  /** Number of most-recent points to maintain in the window. */
  windowSize: number;
  /** Coordinate dimensions per point. */
  dims: number;
  /** Vietoris–Rips threshold epsilon applied within each window. */
  maxDist: number;
  /**
   * Maximum homology dimension to compute: 0 = H0 only, 1 = H0+H1,
   * 2 = H0+H1+H2. Default 2 (was 1 before H2 support was added; setting
   * it to 1 matches the original behavior of this class).
   */
  maxDim?: number;
}

/** Result returned by {@link IncrementalH1}'s `push()` after each new point. */
export interface IncrementalH1Update {
  windowSize: number;
  isFull: boolean;
  pairs: PersistencePair[];
  complex: {
    numVertices: number;
    numEdges: number;
    numTriangles: number;
    numTetrahedra: number;
  };
  /** How much of the matrix was actually re-reduced this push (diagnostics). */
  stats: {
    reReducedTriangles: number;
    totalTriangles: number;
    reReducedTetrahedra: number;
    totalTetrahedra: number;
  };
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

interface TetRec {
  idA: number; // stable point id, idA < idB < idC < idD
  idB: number;
  idC: number;
  idD: number;
  val: number;
  t1: number; // index into the (NEW) triOrder array for triangle (idA,idB,idC)
  t2: number; // index for triangle (idA,idB,idD)
  t3: number; // index for triangle (idA,idC,idD)
  t4: number; // index for triangle (idB,idC,idD)
}

function cmpEdge(x: EdgeRec, y: EdgeRec): number {
  if (x.val !== y.val) {
    return x.val - y.val;
  }
  if (x.idA !== y.idA) {
    return x.idA - y.idA;
  }
  return x.idB - y.idB;
}

function cmpTri(x: TriRec, y: TriRec): number {
  if (x.val !== y.val) {
    return x.val - y.val;
  }
  if (x.idA !== y.idA) {
    return x.idA - y.idA;
  }
  if (x.idB !== y.idB) {
    return x.idB - y.idB;
  }
  return x.idC - y.idC;
}

function cmpTet(x: TetRec, y: TetRec): number {
  if (x.val !== y.val) {
    return x.val - y.val;
  }
  if (x.idA !== y.idA) {
    return x.idA - y.idA;
  }
  if (x.idB !== y.idB) {
    return x.idB - y.idB;
  }
  if (x.idC !== y.idC) {
    return x.idC - y.idC;
  }
  return x.idD - y.idD;
}

/**
 * Streaming H0+H1 persistent homology over a sliding window of points,
 * Phase B ("incremental") implementation -- unlike {@link StreamingHomology},
 * this updates the existing reduced boundary matrix via local pivot
 * bookkeeping on each `push()` instead of re-reducing the whole window from
 * scratch. See this file's top docstring for the algorithm, its memory
 * history (pooled typed-array storage, ~7.3x-52.5x retained-memory
 * reduction over an earlier revision), and the still-open per-instance
 * memory trade-off versus `StreamingHomology`.
 */
export class IncrementalH1 {
  private readonly windowSize: number;
  private readonly dims: number;
  private readonly maxDist: number;

  private pointOrder: number[] = []; // FIFO of stable ids, oldest first
  private flatPtCoords: Float64Array; // k*dims flat array
  private ptCount = 0; // = pointOrder.length
  private nextId = 0;

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
  private readonly workingH2: DenseWorkingCol = new DenseWorkingCol(0);

  // Reused per-push typed arrays -- replaces a new Int32Array(n).fill(-1)
  // allocation per push (oldEdgeIdxToNew) and a new Int32Array(3) per push
  // (boundaryScratch).
  private oldEdgeIdxToNew: Int32Array = new Int32Array(0);
  private boundaryScratch: Int32Array = new Int32Array(3);
  private boundaryScratch4: Int32Array = new Int32Array(4);

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
  /** Which triangles reduced to zero during H1 (ker(∂₂)), cached for H2 nullspace carry-forward. */
  private triNullspace: Uint8Array = new Uint8Array(0);

  // --- H2: tetrahedron pooled state (same pattern as triangles) ---
  private tetIdA: Int32Array = new Int32Array(0);
  private tetIdB: Int32Array = new Int32Array(0);
  private tetIdC: Int32Array = new Int32Array(0);
  private tetIdD: Int32Array = new Int32Array(0);
  private tetVal: Float64Array = new Float64Array(0);
  private tetT1: Int32Array = new Int32Array(0); // index into triOrder
  private tetT2: Int32Array = new Int32Array(0);
  private tetT3: Int32Array = new Int32Array(0);
  private tetT4: Int32Array = new Int32Array(0);
  private pivotOfTriIdx: Int32Array = new Int32Array(0); // len = triIdA.length
  private tetColPool: Int32Array = new Int32Array(0);
  private tetColOffset: Int32Array = new Int32Array(0);
  private tetColLength: Int32Array = new Int32Array(0);
  private tetPairHas: Uint8Array = new Uint8Array(0);
  private tetPairBirth: Float64Array = new Float64Array(0);
  private tetPairDeath: Float64Array = new Float64Array(0);

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

  /** Pack a transient array-of-(Int32Array|null) into the tetra pooled representation. */
  private packTetReducedCols(cols: (Int32Array | null)[]): void {
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
    this.tetColPool = pool;
    this.tetColOffset = offset;
    this.tetColLength = length;
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

  /** Pack a transient array-of-(PersistencePair|null) into the tetra pooled representation. */
  private packTetPair(pairs: (PersistencePair | null)[]): void {
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
    this.tetPairHas = has;
    this.tetPairBirth = birth;
    this.tetPairDeath = death;
  }

  private readonly maxDim: number;

  constructor(opts: IncrementalH1Options) {
    // Matches SlidingWindow's validation (src/streaming/sliding-window.ts) --
    // this class doesn't delegate to SlidingWindow (it manages its own
    // pointOrder and flatPtCoords FIFO for the sliding-window mechanism),
    // so it never inherited that class's guard rails and previously
    // accepted windowSize<=0, non-integer windowSize, or dims<=0 silently,
    // leading to confusing behavior on push() (or none at all) rather than
    // a clear error at construction time.
    if (!Number.isInteger(opts.windowSize) || opts.windowSize < 2) {
      throw new Error(
        "IncrementalH1: windowSize must be an integer >= 2 (push() returns null below 2 points)"
      );
    }
    if (!Number.isInteger(opts.dims) || opts.dims < 1) {
      throw new Error("IncrementalH1: dims must be an integer >= 1");
    }
    if (!(opts.maxDist >= 0)) {
      // catches negative AND NaN (NaN >= 0 is false)
      throw new Error("IncrementalH1: maxDist must be a non-negative number");
    }
    const maxDim = opts.maxDim ?? 1;
    if (!Number.isInteger(maxDim) || maxDim < 0 || maxDim > 2) {
      throw new Error("IncrementalH1: maxDim must be 0, 1, or 2");
    }
    this.maxDim = maxDim;
    this.windowSize = opts.windowSize;
    this.dims = opts.dims;
    this.maxDist = opts.maxDist;
    this.flatPtCoords = new Float64Array(opts.windowSize * opts.dims);
  }

  get size(): number {
    return this.ptCount;
  }

  get isFull(): boolean {
    return this.ptCount === this.windowSize;
  }

  push(point: number[] | Float64Array): IncrementalH1Update | null {
    if (point.length !== this.dims) {
      throw new Error(
        `IncrementalH1: expected point of length ${this.dims}, got ${point.length}`
      );
    }
    const coords = [...point];
    const newId = this.nextId++;

    const wasFull = this.pointOrder.length === this.windowSize;
    const evictedId = wasFull ? this.pointOrder[0]! : null;

    this.pointOrder.push(newId);
    if (wasFull) {
      this.pointOrder.shift();
      this.flatPtCoords.copyWithin(0, this.dims, this.windowSize * this.dims);
    } else {
      this.ptCount++;
    }
    const ptBase = (this.ptCount - 1) * this.dims;
    for (let d = 0; d < this.dims; d++) {
      this.flatPtCoords[ptBase + d] = coords[d]!;
    }
    const k = this.ptCount;

    if (k < 2) {
      return null;
    }

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
      if (evictedId !== null && (e.idA === evictedId || e.idB === evictedId)) {
        continue;
      }
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
      for (let i = 0; i < triCount; i++) {
        survivingTriOrigIdx.push(i);
      }
    } else {
      for (let i = 0; i < triCount; i++) {
        if (
          this.triIdA[i] === evictedId ||
          this.triIdB[i] === evictedId ||
          this.triIdC[i] === evictedId
        ) {
          continue;
        }
        survivingTriOrigIdx.push(i);
      }
    }

    // New point's neighbors: O(k) distance computations against every other
    // point still in the window (only the new point pays this, not all k).
    const newNeighbors = new Set<number>();
    const newEdgeCandidates: EdgeRec[] = [];
    for (let i = 0; i < this.ptCount - 1; i++) {
      const otherId = this.pointOrder[i]!;
      const base = i * this.dims;
      let s = 0;
      for (let d = 0; d < this.dims; d++) {
        const diff = coords[d]! - this.flatPtCoords[base + d]!;
        s += diff * diff;
      }
      const v = Math.sqrt(s);
      if (v <= this.maxDist) {
        newNeighbors.add(otherId);
        newEdgeCandidates.push({
          idA: Math.min(newId, otherId),
          idB: Math.max(newId, otherId),
          val: v,
        });
      }
    }
    newEdgeCandidates.sort(cmpEdge);

    // Merge survivingEdges (already sorted from last push) with
    // newEdgeCandidates (sorted, small) into the final sorted edge list —
    // O(total edges), not an O(k log k) full re-sort. While merging:
    // (a) remember each surviving edge's old-index -> new-index remap
    //     (positions shift because of the filter/merge), needed to fix up
    //     survivingTris' boundary-edge indices below;
    // (b) record a small pair-index for any edge whose both endpoints are
    //     among the new point and its neighbors — exactly what's needed
    //     to resolve the boundary edges of the new triangles further down.
    //     Uses a flat Int32Array indexed by position-within-relevant-set
    //     (replaces a previous Map-of-Map that created O(deg(new)) Map
    //     objects per push — fix #4).
    const relevantIdx = new Map<number, number>();
    for (const id of newNeighbors) {
      relevantIdx.set(id, relevantIdx.size);
    }
    relevantIdx.set(newId, relevantIdx.size);
    const r = relevantIdx.size;
    const pairIdxFlat = new Int32Array(r * r).fill(-1);
    const recordPair = (e: EdgeRec, idx: number): void => {
      const pi = relevantIdx.get(e.idA);
      if (pi === undefined) {
        return;
      }
      const pj = relevantIdx.get(e.idB);
      if (pj === undefined) {
        return;
      }
      pairIdxFlat[pi * r + pj] = idx;
    };
    const newEdges: EdgeRec[] = Array.from<EdgeRec>({
      length: survivingEdges.length + newEdgeCandidates.length,
    });
    // Indexed by ORIGINAL position in this.edgeOrder (pre-filter) — that is
    // the index space survivingTrisUnfiltered's e1/e2/e3 were written in.
    {
      if (this.oldEdgeIdxToNew.length < this.edgeOrder.length) {
        this.oldEdgeIdxToNew = new Int32Array(this.edgeOrder.length);
      }
      this.oldEdgeIdxToNew.fill(-1, 0, this.edgeOrder.length);
    }
    {
      let i = 0;
      let j = 0;
      let w = 0;
      while (i < survivingEdges.length && j < newEdgeCandidates.length) {
        const a = survivingEdges[i]!;
        const b = newEdgeCandidates[j]!;
        if (cmpEdge(a, b) <= 0) {
          newEdges[w] = a;
          this.oldEdgeIdxToNew[survivingEdgeOrigIdx[i]!] = w;
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
        this.oldEdgeIdxToNew[survivingEdgeOrigIdx[i]!] = w;
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
      const pi = relevantIdx.get(lo);
      if (pi === undefined) {
        return -1;
      }
      const pj = relevantIdx.get(hi);
      if (pj === undefined) {
        return -1;
      }
      return pairIdxFlat[pi * r + pj]!;
    };

    // Remap surviving triangles' boundary-edge indices to their new
    // positions (identity/value unchanged, only array position shifts).
    // Reads straight from the pooled arrays via each survivor's original
    // index -- builds flat SoA arrays directly instead of TriRec objects
    // (fix #6: ~O(T) TriRec object allocations per push eliminated).
    const survCount = survivingTriOrigIdx.length;
    const sIdA = new Int32Array(survCount);
    const sIdB = new Int32Array(survCount);
    const sIdC = new Int32Array(survCount);
    const sVal = new Float64Array(survCount);
    const sE1 = new Int32Array(survCount);
    const sE2 = new Int32Array(survCount);
    const sE3 = new Int32Array(survCount);
    for (let ci = 0; ci < survCount; ci++) {
      const oi = survivingTriOrigIdx[ci]!;
      sIdA[ci] = this.triIdA[oi]!;
      sIdB[ci] = this.triIdB[oi]!;
      sIdC[ci] = this.triIdC[oi]!;
      sVal[ci] = this.triVal[oi]!;
      sE1[ci] = this.oldEdgeIdxToNew[this.triE1[oi]!]!;
      sE2[ci] = this.oldEdgeIdxToNew[this.triE2[oi]!]!;
      sE3[ci] = this.oldEdgeIdxToNew[this.triE3[oi]!]!;
    }

    // New triangles provably must include the new point: every pair of the
    // new point's neighbors that are themselves adjacent forms exactly one
    // new triangle. O(deg(new)^2) worst case, not O(k^3).
    const newNeighborsArr = [...newNeighbors];
    const newTriCandidates: TriRec[] = [];
    for (let a = 0; a < newNeighborsArr.length; a++) {
      const p = newNeighborsArr[a]!;
      for (let b = a + 1; b < newNeighborsArr.length; b++) {
        const q = newNeighborsArr[b]!;
        if (getEdgeIdx(p, q) < 0) {
          continue;
        }
        let idA = newId;
        let idB = p;
        let idC = q;
        if (idA > idB) {
          const t = idA;
          idA = idB;
          idB = t;
        }
        if (idB > idC) {
          const t = idB;
          idB = idC;
          idC = t;
        }
        if (idA > idB) {
          const t = idA;
          idA = idB;
          idB = t;
        }
        const e1 = getEdgeIdx(idA, idB);
        const e2 = getEdgeIdx(idA, idC);
        const e3 = getEdgeIdx(idB, idC);
        const val = Math.max(
          newEdges[e1]!.val,
          newEdges[e2]!.val,
          newEdges[e3]!.val
        );
        newTriCandidates.push({ e1, e2, e3, idA, idB, idC, val });
      }
    }
    newTriCandidates.sort(cmpTri);

    // Merge survivors (flat SoA arrays, sorted) with newTriCandidates (sorted
    // TriRec[], small) into flat output arrays -- avoids creating ~O(T) TriRec
    // objects per push (fix #6).
    const newTrisCount = survCount + newTriCandidates.length;
    const mIdA = new Int32Array(newTrisCount);
    const mIdB = new Int32Array(newTrisCount);
    const mIdC = new Int32Array(newTrisCount);
    const mVal = new Float64Array(newTrisCount);
    const mE1 = new Int32Array(newTrisCount);
    const mE2 = new Int32Array(newTrisCount);
    const mE3 = new Int32Array(newTrisCount);
    {
      let i = 0;
      let j = 0;
      let w = 0;
      while (i < survCount && j < newTriCandidates.length) {
        const n = newTriCandidates[j]!;
        let d = sVal[i]! - n.val;
        if (d === 0) {
          d = sIdA[i]! - n.idA;
        }
        if (d === 0) {
          d = sIdB[i]! - n.idB;
        }
        if (d === 0) {
          d = sIdC[i]! - n.idC;
        }
        if (d <= 0) {
          mIdA[w] = sIdA[i]!;
          mIdB[w] = sIdB[i]!;
          mIdC[w] = sIdC[i]!;
          mVal[w] = sVal[i]!;
          mE1[w] = sE1[i]!;
          mE2[w] = sE2[i]!;
          mE3[w] = sE3[i]!;
          i++;
        } else {
          mIdA[w] = n.idA;
          mIdB[w] = n.idB;
          mIdC[w] = n.idC;
          mVal[w] = n.val;
          mE1[w] = n.e1;
          mE2[w] = n.e2;
          mE3[w] = n.e3;
          j++;
        }
        w++;
      }
      while (i < survCount) {
        mIdA[w] = sIdA[i]!;
        mIdB[w] = sIdB[i]!;
        mIdC[w] = sIdC[i]!;
        mVal[w] = sVal[i]!;
        mE1[w] = sE1[i]!;
        mE2[w] = sE2[i]!;
        mE3[w] = sE3[i]!;
        i++;
        w++;
      }
      while (j < newTriCandidates.length) {
        const n = newTriCandidates[j]!;
        mIdA[w] = n.idA;
        mIdB[w] = n.idB;
        mIdC[w] = n.idC;
        mVal[w] = n.val;
        mE1[w] = n.e1;
        mE2[w] = n.e2;
        mE3[w] = n.e3;
        j++;
        w++;
      }
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
      triSafeCountRaw < newTrisCount &&
      this.triIdA[triSafeCountRaw] === mIdA[triSafeCountRaw] &&
      this.triIdB[triSafeCountRaw] === mIdB[triSafeCountRaw] &&
      this.triIdC[triSafeCountRaw] === mIdC[triSafeCountRaw]
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
      if (
        mE1[triSafeCount]! >= edgeSafeCount ||
        mE2[triSafeCount]! >= edgeSafeCount ||
        mE3[triSafeCount]! >= edgeSafeCount
      ) {
        break;
      }
    }

    // --- carry forward the safe prefix, re-reduce the rest ---
    const newPivotOfEdgeIdx = new Int32Array(newEdges.length).fill(-1);
    const newReducedCols: (Int32Array | null)[] = Array.from<Int32Array | null>(
      {
        length: newTrisCount,
      }
    ).fill(null);
    const newTriPair: (PersistencePair | null)[] =
      Array.from<PersistencePair | null>({
        length: newTrisCount,
      }).fill(null);

    for (let i = 0; i < edgeSafeCount; i++) {
      const prevPivot = this.pivotOfEdgeIdx[i]!;
      newPivotOfEdgeIdx[i] =
        prevPivot >= 0 && prevPivot < triSafeCount ? prevPivot : -1;
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
        ? {
            birth: this.triPairBirth[ci]!,
            death: this.triPairDeath[ci]!,
            dim: 1,
          }
        : null;
    }

    this.working.ensureCapacity(newEdges.length);
    const { working } = this;
    const nullspaceTrigs = new Uint8Array(newTrisCount); // 1 = triangle in ker(∂₂)
    for (let ci = triSafeCount; ci < newTrisCount; ci++) {
      this.boundaryScratch[0] = mE1[ci]!;
      this.boundaryScratch[1] = mE2[ci]!;
      this.boundaryScratch[2] = mE3[ci]!;
      working.loadFromArray(this.boundaryScratch);
      while (true) {
        const pivot = working.pivot();
        if (pivot < 0) {
          newReducedCols[ci] = new Int32Array(0);
          nullspaceTrigs[ci] = 1;
          break;
        }
        const prev = newPivotOfEdgeIdx[pivot]!;
        if (prev < 0) {
          newPivotOfEdgeIdx[pivot] = ci;
          newReducedCols[ci] = working.toSparse();
          if (mVal[ci]! > newEdges[pivot]!.val) {
            newTriPair[ci] = {
              birth: newEdges[pivot]!.val,
              death: mVal[ci]!,
              dim: 1,
            };
          }
          break;
        }
        const prevCol = newReducedCols[prev];
        if (prevCol === null || prevCol === undefined) {
          break;
        }
        working.xorSparse(prevCol);
      }
    }
    // Carry forward nullspace for the safe prefix triangles
    for (let ci = 0; ci < triSafeCount; ci++) {
      nullspaceTrigs[ci] = this.triNullspace[ci] ?? 0;
    }

    // --- H0, recomputed fresh each push (cheap; not the optimization target) ---
    // Uses computeH0PhaseFromArrays (src/core/h0.ts) -- same function every
    // other engine in this codebase uses, refactored behind a shared
    // implementation to also accept flat typed arrays. This site's edges are
    // keyed by stable point id (idA/idB), not already-local indices, so they're
    // remapped to local window indices [0,k) into flat arrays first -- avoids
    // allocating one EdgeEntry object per edge (~|newEdges| objects per push).
    const ids = this.pointOrder;
    const uArr = new Int32Array(newEdges.length);
    const vArr = new Int32Array(newEdges.length);
    const valArr = new Float64Array(newEdges.length);
    {
      const localIndexById = new Map<number, number>();
      for (let i = 0; i < k; i++) {
        localIndexById.set(ids[i]!, i);
      }
      for (let ei = 0; ei < newEdges.length; ei++) {
        const e = newEdges[ei]!;
        uArr[ei] = localIndexById.get(e.idA)!;
        vArr[ei] = localIndexById.get(e.idB)!;
        valArr[ei] = e.val;
      }
    }
    const { h0Pairs, cycleEdges: cycleEdge } = computeH0PhaseFromArrays(
      k,
      uArr,
      vArr,
      valArr,
      newEdges.length
    );

    const h1Pairs: PersistencePair[] = [];
    if (this.maxDim >= 1) {
      for (let ci = 0; ci < newTrisCount; ci++) {
        if (newTriPair[ci]) {
          h1Pairs.push(newTriPair[ci]!);
        }
      }
      for (let ei = 0; ei < newEdges.length; ei++) {
        if (cycleEdge[ei] && newPivotOfEdgeIdx[ei]! < 0) {
          h1Pairs.push({ birth: newEdges[ei]!.val, death: -1, dim: 1 });
        }
      }
    }

    // --- H2: prefix-stable incremental tetrahedron reduction ---
    const h2Pairs: PersistencePair[] = [];
    let newTetCount = 0;
    let tetSafeCount = 0;
    let newPivotOfTriIdx: Int32Array = new Int32Array(0);
    let newTetReducedCols: (Int32Array | null)[] = [];
    let newTetPair: (PersistencePair | null)[] = [];
    let mTetIdA: Int32Array = new Int32Array(0);
    let mTetIdB: Int32Array = new Int32Array(0);
    let mTetIdC: Int32Array = new Int32Array(0);
    let mTetIdD: Int32Array = new Int32Array(0);
    let mTetVal: Float64Array = new Float64Array(0);
    let mTetT1: Int32Array = new Int32Array(0);
    let mTetT2: Int32Array = new Int32Array(0);
    let mTetT3: Int32Array = new Int32Array(0);
    let mTetT4: Int32Array = new Int32Array(0);

    if (this.maxDim >= 2) {
      const tetCount = this.tetIdA.length;

      // Filter tetrahedra that involve the evicted point
      const survivingTetOrigIdx: number[] = [];
      if (evictedId === null) {
        for (let i = 0; i < tetCount; i++) {
          survivingTetOrigIdx.push(i);
        }
      } else {
        for (let i = 0; i < tetCount; i++) {
          if (
            this.tetIdA[i] === evictedId ||
            this.tetIdB[i] === evictedId ||
            this.tetIdC[i] === evictedId ||
            this.tetIdD[i] === evictedId
          ) {
            continue;
          }
          survivingTetOrigIdx.push(i);
        }
      }

      // Build triangle lookup: (idA,idB,idC) → index in merged triangle list.
      // Uses Number-keyed Map with packed offset-from-min-ID to avoid string
      // concatenation (which the class's own docstring documents as a ~50x
      // slowdown in an earlier version of this very hot path).
      const minId = this.pointOrder[0]!;
      const stride = this.windowSize;
      const triIdxMap = new Map<number, number>();
      for (let i = 0; i < newTrisCount; i++) {
        triIdxMap.set(
          ((mIdA[i]! - minId) * stride + (mIdB[i]! - minId)) * stride +
            (mIdC[i]! - minId),
          i
        );
      }
      const triLookup = (a: number, b: number, c: number): number | undefined =>
        triIdxMap.get(
          ((a - minId) * stride + (b - minId)) * stride + (c - minId)
        );

      // For each surviving tetrahedron, remap its boundary triangle indices
      const survTetCount = survivingTetOrigIdx.length;
      const sTetIdA = new Int32Array(survTetCount);
      const sTetIdB = new Int32Array(survTetCount);
      const sTetIdC = new Int32Array(survTetCount);
      const sTetIdD = new Int32Array(survTetCount);
      const sTetVal = new Float64Array(survTetCount);
      const sTetT1 = new Int32Array(survTetCount);
      const sTetT2 = new Int32Array(survTetCount);
      const sTetT3 = new Int32Array(survTetCount);
      const sTetT4 = new Int32Array(survTetCount);
      for (let ci = 0; ci < survTetCount; ci++) {
        const oi = survivingTetOrigIdx[ci]!;
        sTetIdA[ci] = this.tetIdA[oi]!;
        sTetIdB[ci] = this.tetIdB[oi]!;
        sTetIdC[ci] = this.tetIdC[oi]!;
        sTetIdD[ci] = this.tetIdD[oi]!;
        sTetVal[ci] = this.tetVal[oi]!;
        // Boundary triangles: remap old tri index to new tri index
        const lookupTri = (oldTriIdx: number): number => {
          const found = triLookup(
            this.triIdA[oldTriIdx]!,
            this.triIdB[oldTriIdx]!,
            this.triIdC[oldTriIdx]!
          );
          if (found === undefined) {
            throw new Error(
              `BUG: surviving tetrahedron's boundary triangle ${oldTriIdx} not found in merged triangle list; tet=(${this.tetIdA[oi]},${this.tetIdB[oi]},${this.tetIdC[oi]},${this.tetIdD[oi]}). This should never happen — it means a triangle whose vertices all survived eviction is missing from the new triangle list.`
            );
          }
          return found;
        };
        sTetT1[ci] = lookupTri(this.tetT1[oi]!);
        sTetT2[ci] = lookupTri(this.tetT2[oi]!);
        sTetT3[ci] = lookupTri(this.tetT3[oi]!);
        sTetT4[ci] = lookupTri(this.tetT4[oi]!);
      }

      // Enumerate new tetrahedra formed by the new point: for each surviving
      // triangle whose 3 vertices are ALL neighbors of the new point, the
      // 4-vertex set {newId, p, q, r} forms a tetrahedron.
      const newTetCandidates: TetRec[] = [];
      const neighborsSet = new Set(newNeighborsArr);
      if (newNeighborsArr.length >= 3) {
        for (let ci = 0; ci < survCount; ci++) {
          const pa = sIdA[ci]!;
          const pb = sIdB[ci]!;
          const pc = sIdC[ci]!;
          if (
            !neighborsSet.has(pa) ||
            !neighborsSet.has(pb) ||
            !neighborsSet.has(pc)
          ) {
            continue;
          }
          const triIdx = triLookup(pa, pb, pc);
          if (triIdx === undefined) {
            continue;
          }
          // Look up edge values for (newId, pa), (newId, pb), (newId, pc)
          const getNewEdgeVal = (otherId: number): number => {
            const ei = getEdgeIdx(newId, otherId);
            if (ei >= 0 && ei < newEdges.length) {
              return newEdges[ei]!.val;
            }
            return this.maxDist;
          };
          const val = Math.max(
            sVal[ci]!,
            getNewEdgeVal(pa),
            getNewEdgeVal(pb),
            getNewEdgeVal(pc)
          );
          const verts = [newId, pa, pb, pc].toSorted((a, b) => a - b);
          const [a, b, c, d] = [verts[0]!, verts[1]!, verts[2]!, verts[3]!];
          const t1 = triLookup(a, b, c);
          const t2 = triLookup(a, b, d);
          const t3 = triLookup(a, c, d);
          const t4 = triLookup(b, c, d);
          if (
            t1 === undefined ||
            t2 === undefined ||
            t3 === undefined ||
            t4 === undefined
          ) {
            continue;
          }
          newTetCandidates.push({
            idA: a,
            idB: b,
            idC: c,
            idD: d,
            t1,
            t2,
            t3,
            t4,
            val,
          });
        }
      }
      newTetCandidates.sort(cmpTet);

      // Merge surviving + new tetrahedra
      newTetCount = survTetCount + newTetCandidates.length;
      mTetIdA = new Int32Array(newTetCount);
      mTetIdB = new Int32Array(newTetCount);
      mTetIdC = new Int32Array(newTetCount);
      mTetIdD = new Int32Array(newTetCount);
      mTetVal = new Float64Array(newTetCount);
      mTetT1 = new Int32Array(newTetCount);
      mTetT2 = new Int32Array(newTetCount);
      mTetT3 = new Int32Array(newTetCount);
      mTetT4 = new Int32Array(newTetCount);
      {
        let i = 0;
        let j = 0;
        let w = 0;
        while (i < survTetCount && j < newTetCandidates.length) {
          const n = newTetCandidates[j]!;
          let d = sTetVal[i]! - n.val;
          if (d === 0) {
            d = sTetIdA[i]! - n.idA;
          }
          if (d === 0) {
            d = sTetIdB[i]! - n.idB;
          }
          if (d === 0) {
            d = sTetIdC[i]! - n.idC;
          }
          if (d === 0) {
            d = sTetIdD[i]! - n.idD;
          }
          if (d <= 0) {
            mTetIdA[w] = sTetIdA[i]!;
            mTetIdB[w] = sTetIdB[i]!;
            mTetIdC[w] = sTetIdC[i]!;
            mTetIdD[w] = sTetIdD[i]!;
            mTetVal[w] = sTetVal[i]!;
            mTetT1[w] = sTetT1[i]!;
            mTetT2[w] = sTetT2[i]!;
            mTetT3[w] = sTetT3[i]!;
            mTetT4[w] = sTetT4[i]!;
            i++;
          } else {
            mTetIdA[w] = n.idA;
            mTetIdB[w] = n.idB;
            mTetIdC[w] = n.idC;
            mTetIdD[w] = n.idD;
            mTetVal[w] = n.val;
            mTetT1[w] = n.t1;
            mTetT2[w] = n.t2;
            mTetT3[w] = n.t3;
            mTetT4[w] = n.t4;
            j++;
          }
          w++;
        }
        while (i < survTetCount) {
          mTetIdA[w] = sTetIdA[i]!;
          mTetIdB[w] = sTetIdB[i]!;
          mTetIdC[w] = sTetIdC[i]!;
          mTetIdD[w] = sTetIdD[i]!;
          mTetVal[w] = sTetVal[i]!;
          mTetT1[w] = sTetT1[i]!;
          mTetT2[w] = sTetT2[i]!;
          mTetT3[w] = sTetT3[i]!;
          mTetT4[w] = sTetT4[i]!;
          i++;
          w++;
        }
        while (j < newTetCandidates.length) {
          const n = newTetCandidates[j]!;
          mTetIdA[w] = n.idA;
          mTetIdB[w] = n.idB;
          mTetIdC[w] = n.idC;
          mTetIdD[w] = n.idD;
          mTetVal[w] = n.val;
          mTetT1[w] = n.t1;
          mTetT2[w] = n.t2;
          mTetT3[w] = n.t3;
          mTetT4[w] = n.t4;
          j++;
          w++;
        }
      }

      // Longest common tetra identity prefix vs previous push
      let tetSafeCountRaw = 0;
      while (
        tetSafeCountRaw < tetCount &&
        tetSafeCountRaw < newTetCount &&
        this.tetIdA[tetSafeCountRaw] === mTetIdA[tetSafeCountRaw] &&
        this.tetIdB[tetSafeCountRaw] === mTetIdB[tetSafeCountRaw] &&
        this.tetIdC[tetSafeCountRaw] === mTetIdC[tetSafeCountRaw] &&
        this.tetIdD[tetSafeCountRaw] === mTetIdD[tetSafeCountRaw]
      ) {
        tetSafeCountRaw++;
      }

      // Shrink: every safe tetrahedron's 4 boundary triangles must be within
      // the safe triangle prefix (otherwise the triangle's pivot may have
      // changed during H1 re-reduction, invalidating the cached tetra column).
      tetSafeCount = 0;
      for (; tetSafeCount < tetSafeCountRaw; tetSafeCount++) {
        if (
          mTetT1[tetSafeCount]! >= triSafeCount ||
          mTetT2[tetSafeCount]! >= triSafeCount ||
          mTetT3[tetSafeCount]! >= triSafeCount ||
          mTetT4[tetSafeCount]! >= triSafeCount
        ) {
          break;
        }
      }

      // Carry forward safe tetra prefix, init rest
      newPivotOfTriIdx = new Int32Array(newTrisCount).fill(-1);
      newTetReducedCols = Array.from<Int32Array | null>({
        length: newTetCount,
      }).fill(null);
      newTetPair = Array.from<PersistencePair | null>({
        length: newTetCount,
      }).fill(null);

      for (let ci = 0; ci < tetSafeCount; ci++) {
        const off = this.tetColOffset[ci]!;
        const len = this.tetColLength[ci]!;
        newTetReducedCols[ci] = this.tetColPool.subarray(off, off + len);
        newTetPair[ci] = this.tetPairHas[ci]
          ? {
              birth: this.tetPairBirth[ci]!,
              death: this.tetPairDeath[ci]!,
              dim: 2,
            }
          : null;
      }

      // Carry forward pivot-of-triangle entries for triangles in the safe
      // prefix that were claimed by a safe (carried-forward) tetrahedron
      // in the previous push. Without this, the essential-H2 scan below
      // (nullspaceTrigs[t] && newPivotOfTriIdx[t] < 0) would incorrectly
      // emit triangles that ARE killed by a persisted tetrahedron as
      // essential 2-cycles.
      for (let ti = 0; ti < triSafeCount; ti++) {
        const prev = this.pivotOfTriIdx[ti]!;
        if (prev >= 0 && prev < tetSafeCount) {
          newPivotOfTriIdx[ti] = prev;
        }
      }

      // H2 reduction: tetrahedron columns vs triangle pivots
      this.workingH2.ensureCapacity(newTrisCount);
      const { workingH2: working2 } = this;
      for (let ci = tetSafeCount; ci < newTetCount; ci++) {
        this.boundaryScratch4[0] = mTetT1[ci]!;
        this.boundaryScratch4[1] = mTetT2[ci]!;
        this.boundaryScratch4[2] = mTetT3[ci]!;
        this.boundaryScratch4[3] = mTetT4[ci]!;
        working2.loadFromArray(this.boundaryScratch4);
        while (true) {
          const pivot = working2.pivot();
          if (pivot < 0) {
            newTetReducedCols[ci] = new Int32Array(0);
            break;
          }
          const prev = newPivotOfTriIdx[pivot]!;
          if (prev < 0) {
            newPivotOfTriIdx[pivot] = ci;
            newTetReducedCols[ci] = working2.toSparse();
            if (mTetVal[ci]! > mVal[pivot]!) {
              newTetPair[ci] = {
                birth: mVal[pivot]!,
                death: mTetVal[ci]!,
                dim: 2,
              };
            }
            break;
          }
          const prevCol = newTetReducedCols[prev];
          if (prevCol === null || prevCol === undefined) {
            break;
          }
          working2.xorSparse(prevCol);
        }
      }

      // Collect H2 pairs: finite (from reduction) + essential (nullspace triangles)
      for (let ci = 0; ci < newTetCount; ci++) {
        if (newTetPair[ci]) {
          const p = newTetPair[ci]!;
          // Find the pivot triangle index for this tetrahedron
          let pivot = -1;
          for (let ti = 0; ti < newTrisCount; ti++) {
            if (newPivotOfTriIdx[ti] === ci) {
              pivot = ti;
              break;
            }
          }
          if (typeof process !== "undefined" && process.env.DEBUG) {
            const t1 = mTetT1[ci]!,
              t2 = mTetT2[ci]!,
              t3 = mTetT3[ci]!,
              t4 = mTetT4[ci]!;
            console.log(
              `  H2 pair emitted: tet=${ci} val=${mTetVal[ci]} pivotTri=${pivot} pivotVal=${mVal[pivot]!} boundary=[${t1}(v=${mVal[t1]!}),${t2}(v=${mVal[t2]!}),${t3}(v=${mVal[t3]!}),${t4}(v=${mVal[t4]!})] tetVerts=(${mTetIdA[ci]},${mTetIdB[ci]},${mTetIdC[ci]},${mTetIdD[ci]})`
            );
          }
          h2Pairs.push(p);
        }
      }
      for (let ti = 0; ti < newTrisCount; ti++) {
        if (nullspaceTrigs[ti] && newPivotOfTriIdx[ti]! < 0) {
          h2Pairs.push({ birth: mVal[ti]!, death: -1, dim: 2 });
        }
      }
    }

    // commit new state for next push. reducedCols/triPair are packed into
    // pooled storage here (see field comment above) -- newReducedCols and
    // newTriPair (the transient array-of-objects used only for this push's
    // computation, already fully consumed by h1Pairs above) become garbage
    // immediately after this, instead of being what's retained until the
    // next push. triOrder is already in flat SoA arrays (mIdA/B/C, mVal,
    // mE1/E2/E3) — assigned directly, skipping the former packTriOrder call.
    this.edgeOrder = newEdges;
    this.triIdA = mIdA;
    this.triIdB = mIdB;
    this.triIdC = mIdC;
    this.triVal = mVal;
    this.triE1 = mE1;
    this.triE2 = mE2;
    this.triE3 = mE3;
    this.pivotOfEdgeIdx = newPivotOfEdgeIdx;
    this.triNullspace = nullspaceTrigs;
    this.packReducedCols(newReducedCols);
    this.packTriPair(newTriPair);
    this.tetIdA = mTetIdA;
    this.tetIdB = mTetIdB;
    this.tetIdC = mTetIdC;
    this.tetIdD = mTetIdD;
    this.tetVal = mTetVal;
    this.tetT1 = mTetT1;
    this.tetT2 = mTetT2;
    this.tetT3 = mTetT3;
    this.tetT4 = mTetT4;
    this.pivotOfTriIdx = newPivotOfTriIdx;
    this.packTetReducedCols(newTetReducedCols);
    this.packTetPair(newTetPair);

    return {
      complex: {
        numEdges: newEdges.length,
        numTetrahedra: newTetCount,
        numTriangles: newTrisCount,
        numVertices: k,
      },
      isFull: this.isFull,
      pairs: [...h0Pairs, ...h1Pairs, ...h2Pairs],
      stats: {
        reReducedTetrahedra: this.maxDim >= 2 ? newTetCount - tetSafeCount : 0,
        reReducedTriangles: newTrisCount - triSafeCount,
        totalTetrahedra: this.maxDim >= 2 ? newTetCount : 0,
        totalTriangles: newTrisCount,
      },
      windowSize: k,
    };
  }
}

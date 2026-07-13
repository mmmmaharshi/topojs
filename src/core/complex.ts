import type { Points } from "./distance.ts";
import type { EdgeEntry } from "./h0.ts";
import { selectLandmarks } from "./landmarks.ts";
import { SpatialGrid } from "./spatial-grid.ts";

function euclidean(points: Points, dims: number, i: number, j: number): number {
  const bi = i * dims;
  const bj = j * dims;
  let sq = 0;
  for (let d = 0; d < dims; d++) {
    const diff = points[bi + d]! - points[bj + d]!;
    sq += diff * diff;
  }
  return Math.sqrt(sq);
}

/**
 * Metadata for the Sheehy sparse Rips construction.
 * (1+epsilon)-interleaving guarantee with the full Rips filtration.
 */
export interface SheehyInfo {
  /** Permutation of point indices (greedy permutation order). */
  perm: Int32Array;
  /** Insertion radius of each point in the permutation (radii[0] = 0). */
  radii: Float64Array;
  /** Approximation parameter. */
  epsilon: number;
  /** Number of active points at the given maxDist. */
  activeCount: number;
  /** The covering radius (largest insertion radius of any non-active point). */
  coveringRadius: number;
}

/** A triangle (2-simplex) in the Rips complex. */
export interface TriangleEntry {
  /** Indices of the 3 edges in the edge array. */
  edges: [number, number, number];
  /** Vertex indices [u, v, w] with u < v < w. */
  verts: [number, number, number];
  /** Filtration value = max of the 3 edge distances. */
  val: number;
}

/** A tetrahedron (3-simplex) in the Rips complex. */
export interface TetraEntry {
  /** Indices of the 4 boundary triangles in the triangle array. */
  triangles: [number, number, number, number];
  /** Filtration value = max of the 6 edge distances. */
  val: number;
}

interface TempEdge {
  u: number;
  v: number;
  val: number;
  origIdx: number;
}

/**
 * The Vietoris–Rips complex up to dimension 3.
 *
 * Edge enumeration uses a uniform spatial grid (src/core/spatial-grid.ts,
 * cellSize = maxDist) to narrow candidate pairs before computing any
 * distance, when maxDist is finite and positive: O(n · 3^dims) candidate
 * checks instead of a brute-force O(n²) scan, with the SAME exact edges and
 * filtration values as brute force (the grid only rules out pairs that are
 * geometrically impossible to be within maxDist -- see spatial-grid.ts's
 * docstring for the correctness argument). Falls back to the original
 * brute-force O(n²) double loop when maxDist is 0, negative, infinite, or
 * NaN (the grid isn't meaningful without a finite positive cell size, and
 * an unbounded/degenerate threshold means every/no pair is a candidate
 * anyway, so there's nothing for the grid to narrow).
 *
 * Triangle/tetrahedron filtration values are computed by reusing already-
 * discovered edge values (via edgeIndex) rather than a second O(n²)
 * distance-matrix lookup -- every pair needed for a triangle or tetrahedron
 * boundary is, by construction of the bit-vector adjacency it's found
 * through, already a known edge. This also means buildRipsComplex no longer
 * needs to build a full O(n²) DistanceMatrix at all (computePairwiseDistances
 * remains a separate, independently useful public export -- see src/index.ts
 * -- just no longer a dependency of this function).
 *
 * Triangle enumeration uses bit-vector adjacency intersection
 * (Uint32Array per vertex, Math.clz32 for trailing-zero count):
 * O(|E| · n/w) per triangle, where w = 32.
 *
 * For an n-point cloud at threshold ε:
 *   |E| = O(n²)    in the worst case (dense)
 *   |T| = O(n³)    in the worst case (dense)
 *   |Tet| = O(n⁴)  in the worst case (dense, maxDim=3)
 *
 * For sparse thresholds (ε ≪ diameter), |E| ≈ O(n · εᵈ), and the spatial
 * grid above lets edge enumeration approach that same O(n · εᵈ) cost
 * instead of always paying O(n²) to discover it.
 *
 * **The grid has real per-point overhead (Map lookups, small-array
 * allocation) that brute force doesn't, so it is NOT a strict win at every
 * n.** Isolated edge-building-only benchmarks (both approaches building the
 * same full edge array, JIT-warmed, averaged over repeated trials) across
 * two density regimes originally found a crossover around n≈900-1000 with
 * the grid's first implementation (string-keyed `Map<string, number[]>`).
 * A later fix (see spatial-grid.ts's class docstring) replaced those keys
 * with packed BigInt keys specifically to cut this per-point overhead; a
 * re-run with finer n steps confirmed the crossover moved down to
 * n≈600-650 in both regimes (bench/data/edge_building_results.txt has the
 * full numbers):
 *
 *   n=400:  0.58x-0.68x (grid still slower)
 *   n=600:  0.93x-1.00x (breakeven)
 *   n=700:  0.96x-1.19x (grid winning, though choppy right at the boundary
 *                        in the denser regime)
 *   n=1000: 1.47x-1.72x (grid clearly winning)
 *   n=3000: 4.04x-4.67x (win grows with n, as expected for O(n)-ish vs O(n²))
 *
 * This means this repo's own current benchmark datasets (n=60-400 in
 * bench/compare_ripser.py and bench/benchmark.ts) are ALL below the
 * crossover -- the grid provides no measured benefit there, and would
 * modestly hurt if used unconditionally. GRID_MIN_N below gates the grid
 * behind a threshold set just above the measured crossover, so
 * buildRipsComplex only pays the grid's setup cost when the data says it's
 * actually going to win; small/moderate n always uses brute force, exactly
 * as before this optimization existed. See spatial-grid.ts's own docstring
 * for why the grid is correctness-safe (candidate superset, not an
 * approximation) independent of this performance threshold.
 *
 * GRID_MIN_N and EDGE_INDEX_DENSE_MAX_N below are deliberately SEPARATE
 * constants, not one shared threshold: they gate two independently-
 * benchmarked decisions (edge-building strategy vs. edgeIndex memory
 * layout) that happen to both be keyed on n, but were verified at
 * different times against different data. Coupling them would mean any
 * future retune of one silently moves the other without re-verification --
 * exactly what happened here: this file's own edge-building crossover
 * moved after a change to spatial-grid.ts, while the edgeIndex memory
 * threshold (verified separately for finding #16) was never re-benchmarked
 * and has no reason to move on the same schedule.
 */
export interface RipsComplex {
  n: number;
  edges: EdgeEntry[];
  triangles: TriangleEntry[];
  tetrahedra: TetraEntry[];

  /** Bit-vector adjacency (n words of ceil(n/32) Uint32). Present when
   * `epsilon` was provided for the Sheehy sparse Rips, or when the
   * downstream caller needs on-demand column generation (implicit matrix). */
  adjBits?: Uint32Array[];
  /** Maps packed vertex-key (u*n+v)*n+w → triangle index. */
  triMap?: Map<number, number>;
  /** Sheehy sparse Rips metadata, present when `epsilon` was provided. */
  sheehy?: SheehyInfo;
}

function triKey(u: number, v: number, w: number, n: number): number {
  return (u * n + v) * n + w;
}

/**
 * n threshold below which buildRipsComplex uses brute force even when
 * maxDist is finite/positive -- set just above the measured crossover
 * (~600-650 with the current BigInt-keyed grid, see this file's top
 * docstring and bench/data/edge_building_results.txt) where the grid's
 * per-point Map/array overhead stops being worth it. This is a
 * deliberately simple, single-density-agnostic constant rather than an
 * adaptive estimate: both regimes measured (sparse and moderate density)
 * crossed over in the same n≈600-650 neighborhood, so a fixed conservative
 * cutoff is a reasonable, honest choice over engineering a density
 * predictor for a boundary that didn't move much between the two regimes
 * actually tested. Governs ONLY the edge-building strategy -- see
 * EDGE_INDEX_DENSE_MAX_N below for why that's a separate constant.
 */
const GRID_MIN_N = 700;

/**
 * n threshold below which the triangle/tetrahedron edgeIndex lookup (below)
 * uses a flat, O(1)-indexed Int32Array instead of a sparse Map<number,
 * number> -- set at the ORIGINAL GRID_MIN_N value (1000) this was verified
 * against when finding #16 fixed the O(n^2) unconditional-allocation bug
 * (a flat n*n array is ~4MB at n=1000, worth the O(1) indexing on this hot
 * path; a sparse Map trades some per-lookup hashing cost for a footprint
 * that tracks |E| instead of n^2).
 *
 * Deliberately NOT reusing GRID_MIN_N: the two thresholds happen to have
 * started at the same value, but they answer different questions
 * (edge-building throughput vs. triangle/tetrahedron-lookup memory) and
 * were verified independently -- GRID_MIN_N has since moved (a spatial-grid.ts
 * key-encoding change lowered its crossover; see this file's top
 * docstring), while nothing has changed the n*n-vs-Map memory trade-off
 * this constant protects. Coupling them would have silently moved this
 * one too, untested.
 */
const EDGE_INDEX_DENSE_MAX_N = 1000;

export function buildRipsComplex(
  points: Points,
  dims: number,
  maxDist: number,
  maxDim = 2,
  epsilon?: number
): RipsComplex {
  const n = points.length / dims;

  // ── Sheehy sparse Rips: compute greedy permutation and active subset ──
  // When epsilon is provided, only points whose insertion radius (distance
  // to nearest earlier point in the greedy permutation) is <= epsilon *
  // maxDist are "active" at this scale. This gives a (1+epsilon)-interleaving
  // with the full Rips filtration (Sheehy 2013, "Linear-Size Approximations
  // to the Vietoris-Rips Filtration", DCG 49(4)).
  let perm: Int32Array | null = null;
  let radii: Float64Array | null = null;
  let activeCount = n;
  let sheehy: SheehyInfo | undefined = undefined;
  if (epsilon !== undefined && epsilon > 0 && Number.isFinite(epsilon)) {
    const lm = selectLandmarks(points, dims, n, n, 0);
    perm = lm.landmarkIndices;
    radii = lm.insertionRadii;
    radii[0] = 0; // first point's insertion radius is 0 (always active)
    // radii is non-increasing: radii[1] >= radii[2] >= ... >= radii[n-1]
    // Active: points with radii[i] <= epsilon * maxDist (always includes point 0)
    const threshold = epsilon * maxDist;
    // radii is non-increasing: radii[0]=0, radii[1] >= radii[2] >= ...
    // Points with radii > threshold are skipped (inactive); the remaining
    // suffix of the permutation is active (radii <= threshold).
    let inactivePrefix = 0;
    for (let i = 1; i < n && radii[i]! > threshold; i++) {
      inactivePrefix++;
    }
    activeCount = n - inactivePrefix;
    let maxCovering = 0;
    for (let i = 1; i <= inactivePrefix; i++) {
      if (radii[i]! > maxCovering) {
        maxCovering = radii[i]!;
      }
    }
    sheehy = {
      activeCount,
      coveringRadius: maxCovering,
      epsilon,
      perm,
      radii,
    };
  }

  // ── Build edges ──
  const tempEdges: TempEdge[] = [];
  const adj: number[][] = Array.from({ length: n }, () => []);

  // Sheehy active-point filter: when epsilon is provided, only edges where
  // BOTH endpoints are among the first `activeCount` points of the greedy
  // permutation are included. Permutation rank arrays map origIdx → permIdx.
  const permRank: Int32Array | null = perm ? new Int32Array(n) : null;
  if (permRank && perm) {
    permRank.fill(-1);
    for (let pi = 0; pi < perm.length; pi++) {
      permRank[perm[pi]!] = pi;
    }
  }
  const isActive = (idx: number): boolean =>
    permRank === null ? true : permRank[idx]! < activeCount;

  // Grid only makes sense for a finite, positive cellSize -- see this
  // function's docstring and spatial-grid.ts for why 0/negative/Infinity/NaN
  // maxDist fall back to brute force instead. Also gated on n >= GRID_MIN_N:
  // below that, the grid's own overhead measurably loses to brute force (see
  // this file's top docstring for the benchmark numbers behind the cutoff).
  // NOTE: when epsilon is provided (Sheehy sparse), skip the grid since the
  // active-point subset is typically small (the grid's overhead isn't worth it).
  const useGrid =
    !epsilon && maxDist > 0 && Number.isFinite(maxDist) && n >= GRID_MIN_N;
  const grid = useGrid ? new SpatialGrid(points, dims, n, maxDist) : null;

  for (let i = 0; i < n; i++) {
    if (!isActive(i)) {
      continue;
    }
    const candidates = grid ? grid.candidatesAfter(points, i) : null;
    const checkPair = (j: number): void => {
      if (!isActive(j)) {
        return;
      }
      const d = euclidean(points, dims, i, j);
      if (d <= maxDist) {
        tempEdges.push({ origIdx: adj[i]!.length, u: i, v: j, val: d });
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    };
    if (candidates) {
      for (const j of candidates) {
        checkPair(j);
      }
    } else {
      for (let j = i + 1; j < n; j++) {
        checkPair(j);
      }
    }
  }

  tempEdges.sort((a, b) => a.val - b.val || a.origIdx - b.origIdx);

  const edges: EdgeEntry[] = tempEdges.map((e) => ({
    u: e.u,
    v: e.v,
    val: e.val,
  }));

  // Dense u*n+v keyspace -> flat Int32Array lookup when n is small (below
  // EDGE_INDEX_DENSE_MAX_N -- a separate constant from GRID_MIN_N above, see
  // its docstring for why). Always queried with u < v (matches insertion
  // order below), so no symmetric fill is needed.
  //
  // BUG FIX: this used to be `new Int32Array(n * n)` UNCONDITIONALLY,
  // regardless of n or of how sparse the actual edge set is -- reintroducing
  // an O(n^2) MEMORY floor exactly in the large-sparse regime the spatial
  // grid exists to serve (1.6GB at n=20,000, before any triangles are even
  // considered). Found during a codebase audit. Below EDGE_INDEX_DENSE_MAX_N,
  // n^2 is small (at most 1,000,000 entries, ~4MB) and the flat array's O(1)
  // direct indexing is worth it on this hot path (called 2-3x per triangle
  // candidate, more for tetrahedra); at or above it, a sparse
  // Map<number,number> trades some per-lookup hashing cost for a footprint
  // that tracks |E| instead of n^2 -- the same time/space trade-off
  // rationale as the grid itself.
  const edgeIndexDense: Int32Array | null =
    n < EDGE_INDEX_DENSE_MAX_N ? new Int32Array(n * n).fill(-1) : null;
  const edgeIndexSparse: Map<number, number> | null = edgeIndexDense
    ? null
    : new Map();
  const setEdgeIndex = (u: number, v: number, idx: number): void => {
    if (edgeIndexDense) {
      edgeIndexDense[u * n + v] = idx;
    } else {
      edgeIndexSparse!.set(u * n + v, idx);
    }
  };
  const getEdgeIndex = (u: number, v: number): number => {
    if (edgeIndexDense) {
      return edgeIndexDense[u * n + v]!;
    }
    return edgeIndexSparse!.get(u * n + v)!;
  };
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    setEdgeIndex(e.u, e.v, i);
  }

  for (let v = 0; v < n; v++) {
    adj[v]!.sort((a, b) => a - b);
  }

  // ── Build bit-vector adjacency ──
  const words = Math.ceil(n / 32);
  const adjBits: Uint32Array[] = Array.from({ length: n });
  for (let v = 0; v < n; v++) {
    const bits = new Uint32Array(words);
    const nbors = adj[v]!;
    for (const nb of nbors) {
      bits[nb >>> 5]! |= 1 << (nb & 31);
    }
    adjBits[v] = bits;
  }

  // ── Build triangles ──
  const triangles: TriangleEntry[] = [];

  for (let ei = 0; ei < edges.length; ei++) {
    const { u, v, val: dij } = edges[ei]!;
    const bu = adjBits[u]!;
    const bv = adjBits[v]!;
    const startWord = (v + 1) >>> 5;
    const startBit = (v + 1) & 31;

    for (let w = startWord; w < words; w++) {
      let bits = bu[w]! & bv[w]!;
      if (w === startWord && startBit > 0) {
        bits &= ~((1 << startBit) - 1);
      }
      while (bits) {
        const lsb = bits & -bits;
        const bit = Math.clz32(lsb) ^ 31;
        const k = (w << 5) + bit;
        bits ^= lsb;

        // k > v > u always holds here (bit scan starts at v+1), so both
        // queries are in edgeIndex's u<v convention and both are guaranteed
        // present (k is a bit-vector neighbor of both u and v, i.e. edges
        // (u,k) and (v,k) exist by construction). Reusing the already-
        // computed edge .val (not a second distance computation, and not
        // even a lookup into a separate O(n^2) distance matrix, which this
        // function no longer builds at all) is not just faster: it's
        // bit-for-bit identical to the old lookupDist(dist,u,k) value,
        // since that value ultimately CAME from this same edge's own
        // distance computation in the first place.
        const ukIdx = getEdgeIndex(u, k);
        const vkIdx = getEdgeIndex(v, k);
        const dik = edges[ukIdx]!.val;
        const djk = edges[vkIdx]!.val;
        const birth = Math.max(dij, dik, djk);
        triangles.push({
          // (u, v) is exactly the current outer-loop edge -- ei is already
          // its index, no lookup needed (was a redundant Map.get before).
          edges: [ei, ukIdx, vkIdx],
          val: birth,
          verts: [u, v, k],
        });
      }
    }
  }

  triangles.sort((a, b) => a.val - b.val);

  // ── Build vertex→triangle index map ──
  // Exposed as an optional return field for the implicit-matrix cohomology
  // engine (which generates coboundary columns on-demand instead of using
  // a pre-built CSR inverted index).
  const triMapExposed = new Map<number, number>();
  for (let ti = 0; ti < triangles.length; ti++) {
    const [tu, tv, tw] = triangles[ti]!.verts;
    triMapExposed.set(triKey(tu, tv, tw, n), ti);
  }

  // ── Build tetrahedra (if maxDim >= 3) ──
  const tetrahedra: TetraEntry[] = [];

  if (maxDim >= 3) {
    for (let ti = 0; ti < triangles.length; ti++) {
      const [su, sv, sw] = triangles[ti]!.verts;
      const triVal = triangles[ti]!.val;

      const bu = adjBits[su]!;
      const bv = adjBits[sv]!;
      const bw = adjBits[sw]!;
      const startWord = (sw + 1) >>> 5;
      const startBit = (sw + 1) & 31;

      for (let wd = startWord; wd < words; wd++) {
        let bits = bu[wd]! & bv[wd]! & bw[wd]!;
        if (wd === startWord && startBit > 0) {
          bits &= ~((1 << startBit) - 1);
        }
        while (bits) {
          const lsb = bits & -bits;
          const bit = Math.clz32(lsb) ^ 31;
          const x = (wd << 5) + bit;
          bits ^= lsb;

          // Same reasoning as the triangle loop above: x > sw > sv > su
          // always holds here, so su<x, sv<x, sw<x are all valid u<v
          // edgeIndex queries, guaranteed present, and reusing their .val
          // is bit-for-bit identical to the old distance-matrix lookups.
          const dux = edges[getEdgeIndex(su, x)]!.val;
          const dvx = edges[getEdgeIndex(sv, x)]!.val;
          const dwx = edges[getEdgeIndex(sw, x)]!.val;
          const birth = Math.max(triVal, dux, dvx, dwx);

          tetrahedra.push({
            triangles: [
              triMapExposed.get(triKey(sv, sw, x, n))!,
              triMapExposed.get(triKey(su, sw, x, n))!,
              triMapExposed.get(triKey(su, sv, x, n))!,
              ti,
            ],
            val: birth,
          });
        }
      }
    }

    tetrahedra.sort((a, b) => a.val - b.val);
  }

  return {
    adjBits,
    edges,
    n,
    sheehy,
    tetrahedra,
    triMap: triMapExposed,
    triangles,
  };
}

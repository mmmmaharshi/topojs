import { CombinatorialIndex } from "./combinatorial-index.ts";
import type { SheehyInfo } from "./complex.ts";
import type { Points } from "./distance.ts";
import type { EdgeEntry } from "./h0.ts";
import { selectLandmarks } from "./landmarks.ts";
import { SpatialGrid } from "./spatial-grid.ts";

const GRID_MIN_N = 700;
const EDGE_INDEX_DENSE_MAX_N = 1000;

export interface ImplicitRipsComplex {
  n: number;
  maxDist: number;
  edges: EdgeEntry[];
  adjBits: Uint32Array[];
  sheehy?: SheehyInfo;
  _edgeVals: Float64Array;
  _getEdgeIndex: (u: number, v: number) => number;
  _combinatorialIndex: CombinatorialIndex;
}

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

export function buildImplicitRipsComplex(
  points: Points,
  dims: number,
  maxDist: number,
  epsilon?: number
): ImplicitRipsComplex {
  const n = points.length / dims;

  let perm: Int32Array | null = null;
  let radii: Float64Array | null = null;
  let activeCount = n;
  let sheehy: SheehyInfo | undefined = undefined;
  if (epsilon !== undefined && epsilon > 0 && Number.isFinite(epsilon)) {
    const lm = selectLandmarks(points, dims, n, n, 0);
    perm = lm.landmarkIndices;
    radii = lm.insertionRadii;
    radii[0] = 0;
    const threshold = epsilon * maxDist;
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

  const tempEdges: { u: number; v: number; val: number; origIdx: number }[] =
    [];
  const adj: number[][] = Array.from({ length: n }, () => []);

  const permRank: Int32Array | null = perm ? new Int32Array(n) : null;
  if (permRank && perm) {
    permRank.fill(-1);
    for (let pi = 0; pi < perm.length; pi++) {
      permRank[perm[pi]!] = pi;
    }
  }
  const isActive = (idx: number): boolean =>
    permRank === null ? true : permRank[idx]! < activeCount;

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

  const edgeVals = new Float64Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    setEdgeIndex(e.u, e.v, i);
    edgeVals[i] = e.val;
  }

  for (let v = 0; v < n; v++) {
    adj[v]!.sort((a, b) => a - b);
  }

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

  return {
    _combinatorialIndex: new CombinatorialIndex(n),
    _edgeVals: edgeVals,
    _getEdgeIndex: getEdgeIndex,
    adjBits,
    edges,
    maxDist,
    n,
    sheehy,
  };
}

export function triVal(
  complex: ImplicitRipsComplex,
  u: number,
  v: number,
  w: number
): number {
  const edgeUV = complex._getEdgeIndex(u, v);
  const edgeUW = complex._getEdgeIndex(u, w);
  const edgeVW = complex._getEdgeIndex(v, w);
  const duv = complex._edgeVals[edgeUV]!;
  const duw = complex._edgeVals[edgeUW]!;
  const dvw = complex._edgeVals[edgeVW]!;
  return Math.max(duv, duw, dvw);
}

export function triValByRank(
  complex: ImplicitRipsComplex,
  rank: number
): number {
  const [u, v, w] = complex._combinatorialIndex.unrank(rank);
  return triVal(complex, u, v, w);
}

export function tetVal(
  complex: ImplicitRipsComplex,
  a: number,
  b: number,
  c: number,
  d: number
): number {
  const dab = complex._edgeVals[complex._getEdgeIndex(a, b)]!;
  const dac = complex._edgeVals[complex._getEdgeIndex(a, c)]!;
  const dad = complex._edgeVals[complex._getEdgeIndex(a, d)]!;
  const dbc = complex._edgeVals[complex._getEdgeIndex(b, c)]!;
  const dbd = complex._edgeVals[complex._getEdgeIndex(b, d)]!;
  const dcd = complex._edgeVals[complex._getEdgeIndex(c, d)]!;
  const m1 = dab >= dac ? dab : dac;
  const m2 = dad >= dbc ? dad : dbc;
  const m3 = dbd >= dcd ? dbd : dcd;
  const m12 = m1 >= m2 ? m1 : m2;
  return m12 >= m3 ? m12 : m3;
}

export function tetValByRank(
  complex: ImplicitRipsComplex,
  rank: number
): number {
  const [a, b, c, d] = complex._combinatorialIndex.unrank4(rank);
  return tetVal(complex, a, b, c, d);
}

export function countImplicitTriangles(
  complex: ImplicitRipsComplex,
  filterMaxDist?: number
): number {
  const { adjBits, edges, n } = complex;
  const maxDist = filterMaxDist ?? complex.maxDist;
  const words = Math.ceil(n / 32);
  let count = 0;

  for (const { u, v } of edges) {
    const bu = adjBits[u]!;
    const bv = adjBits[v]!;
    const startWord = (v + 1) >>> 5;
    const startBit = (v + 1) & 31;

    for (let wd = startWord; wd < words; wd++) {
      let bits = bu[wd]! & bv[wd]!;
      if (wd === startWord && startBit > 0) {
        bits &= ~((1 << startBit) - 1);
      }
      while (bits) {
        const lsb = bits & -bits;
        const bit = Math.clz32(lsb) ^ 31;
        const k = (wd << 5) + bit;
        bits ^= lsb;

        if (triVal(complex, u, v, k) <= maxDist) {
          count++;
        }
      }
    }
  }

  return count;
}

export function forEachImplicitTriangle(
  complex: ImplicitRipsComplex,
  fn: (u: number, v: number, w: number, val: number) => void,
  filterMaxDist?: number
): void {
  const { adjBits, edges, n } = complex;
  const maxDist = filterMaxDist ?? complex.maxDist;
  const words = Math.ceil(n / 32);

  for (const { u, v } of edges) {
    const bu = adjBits[u]!;
    const bv = adjBits[v]!;
    const startWord = (v + 1) >>> 5;
    const startBit = (v + 1) & 31;

    for (let wd = startWord; wd < words; wd++) {
      let bits = bu[wd]! & bv[wd]!;
      if (wd === startWord && startBit > 0) {
        bits &= ~((1 << startBit) - 1);
      }
      while (bits) {
        const lsb = bits & -bits;
        const bit = Math.clz32(lsb) ^ 31;
        const k = (wd << 5) + bit;
        bits ^= lsb;

        const val = triVal(complex, u, v, k);
        if (val <= maxDist) {
          fn(u, v, k, val);
        }
      }
    }
  }
}

import type { Points } from "./distance.ts";
import { enclosingRadius } from "./distance.ts";
import { collapseDominatedEdges } from "./edge-collapse.ts";
import type { EdgeEntry } from "./h0.ts";
import { selectLandmarks } from "./landmarks.ts";
import { SpatialGrid } from "./spatial-grid.ts";

const GRID_MIN_N = 700;
const EDGE_INDEX_DENSE_MAX_N = 1000;

export interface RipsSkeleton {
  n: number;
  maxDist: number;
  edges: EdgeEntry[];
  adjBits: Uint32Array[];
  edgeIndex: (u: number, v: number) => number;
  edgeValue: (u: number, v: number) => number;
}

export interface RipsSkeletonOptions {
  collapseMaxDim?: number;
  epsilon?: number;
}

function squaredEuclidean(
  points: Points,
  dims: number,
  i: number,
  j: number
): number {
  const bi = i * dims;
  const bj = j * dims;
  let sq = 0;
  for (let d = 0; d < dims; d++) {
    const diff = points[bi + d]! - points[bj + d]!;
    sq += diff * diff;
  }
  return sq;
}

export function buildRipsSkeleton(
  points: Points,
  dims: number,
  maxDist: number,
  options: RipsSkeletonOptions = {}
): RipsSkeleton {
  const n = points.length / dims;
  let effectiveMaxDist = maxDist;
  if (
    options.epsilon === undefined &&
    maxDist > 0 &&
    !Number.isFinite(maxDist)
  ) {
    const radius = enclosingRadius(points, dims);
    if (radius < effectiveMaxDist) {
      effectiveMaxDist = radius;
    }
  }

  let permutation: Int32Array | null = null;
  let activeCount = n;
  if (
    options.epsilon !== undefined &&
    options.epsilon > 0 &&
    Number.isFinite(options.epsilon)
  ) {
    const landmarks = selectLandmarks(points, dims, n, n, 0);
    permutation = landmarks.landmarkIndices;
    landmarks.insertionRadii[0] = 0;
    const threshold = options.epsilon * maxDist;
    let inactivePrefix = 0;
    for (let i = 1; i < n && landmarks.insertionRadii[i]! > threshold; i++) {
      inactivePrefix++;
    }
    activeCount = n - inactivePrefix;
  }

  const tempEdges: EdgeEntry[] = [];
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  const permutationRank: Int32Array | null = permutation
    ? new Int32Array(n)
    : null;
  if (permutationRank !== null && permutation !== null) {
    permutationRank.fill(-1);
    for (let i = 0; i < permutation.length; i++) {
      permutationRank[permutation[i]!] = i;
    }
  }

  const useGrid =
    !options.epsilon &&
    effectiveMaxDist > 0 &&
    Number.isFinite(effectiveMaxDist) &&
    n >= GRID_MIN_N;
  const grid = useGrid
    ? new SpatialGrid(points, dims, n, effectiveMaxDist)
    : null;
  const maxDistSq = effectiveMaxDist * effectiveMaxDist;

  for (let i = 0; i < n; i++) {
    if (permutationRank !== null && permutationRank[i]! >= activeCount) {
      continue;
    }
    const candidates = grid === null ? null : grid.candidatesAfter(points, i);
    if (candidates) {
      for (const j of candidates) {
        if (permutationRank !== null && permutationRank[j]! >= activeCount) {
          continue;
        }
        const sq = squaredEuclidean(points, dims, i, j);
        if (sq <= maxDistSq) {
          const d = Math.sqrt(sq);
          tempEdges.push({ u: i, v: j, val: d });
          adjacency[i]!.push(j);
          adjacency[j]!.push(i);
        }
      }
    } else {
      for (let j = i + 1; j < n; j++) {
        if (permutationRank !== null && permutationRank[j]! >= activeCount) {
          continue;
        }
        const sq = squaredEuclidean(points, dims, i, j);
        if (sq <= maxDistSq) {
          const d = Math.sqrt(sq);
          tempEdges.push({ u: i, v: j, val: d });
          adjacency[i]!.push(j);
          adjacency[j]!.push(i);
        }
      }
    }
  }

  tempEdges.sort((a, b) => a.val - b.val || a.u - b.u || a.v - b.v);

  const edges = collapseDominatedEdges(n, tempEdges, {
    maxDim: options.collapseMaxDim ?? 2,
  });

  for (let i = 0; i < n; i++) {
    adjacency[i]!.length = 0;
  }
  for (const edge of edges) {
    adjacency[edge.u]!.push(edge.v);
    adjacency[edge.v]!.push(edge.u);
  }

  for (let v = 0; v < n; v++) {
    adjacency[v]!.sort((a, b) => a - b);
  }

  const words = Math.ceil(n / 32);
  const adjBits: Uint32Array[] = Array.from({ length: n });
  for (let v = 0; v < n; v++) {
    const bits = new Uint32Array(words);
    for (const neighbor of adjacency[v]!) {
      bits[neighbor >>> 5]! |= 1 << (neighbor & 31);
    }
    adjBits[v] = bits;
  }

  const edgeIndexDense =
    n < EDGE_INDEX_DENSE_MAX_N ? new Int32Array(n * n).fill(-1) : null;
  const edgeIndexSparse =
    edgeIndexDense === null ? new Map<number, number>() : null;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    const key = edge.u * n + edge.v;
    if (edgeIndexDense) {
      edgeIndexDense[key] = i;
    } else {
      edgeIndexSparse!.set(key, i);
    }
  }

  const edgeIndex = (u: number, v: number): number => {
    const key = u * n + v;
    const index =
      edgeIndexDense === null ? edgeIndexSparse!.get(key) : edgeIndexDense[key];
    return index === undefined ? -1 : index;
  };

  const edgeValue = (u: number, v: number): number => {
    const index = edgeIndex(u < v ? u : v, u < v ? v : u);
    return index < 0 ? Number.NaN : edges[index]!.val;
  };

  return {
    adjBits,
    edgeIndex,
    edgeValue,
    edges,
    maxDist: effectiveMaxDist,
    n,
  };
}

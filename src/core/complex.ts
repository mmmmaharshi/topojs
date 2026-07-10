import type { Points } from './distance.ts';
import { computePairwiseDistances, lookupDist } from './distance.ts';
import type { EdgeEntry } from './h0.ts';

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
 * Edge enumeration uses row-offset distance lookup: O(n²) time.
 * Triangle enumeration uses bit-vector adjacency intersection
 * (Uint32Array per vertex, Math.clz32 for trailing-zero count):
 * O(|E| · n/w) per triangle, where w = 32.
 *
 * For an n-point cloud at threshold ε:
 *   |E| = O(n²)    in the worst case (dense)
 *   |T| = O(n³)    in the worst case (dense)
 *   |Tet| = O(n⁴)  in the worst case (dense, maxDim=3)
 *
 * For sparse thresholds (ε ≪ diameter), |E| ≈ O(n · εᵈ).
 */
export interface RipsComplex {
  n: number;
  edges: EdgeEntry[];
  triangles: TriangleEntry[];
  tetrahedra: TetraEntry[];
}

function edgeKey(u: number, v: number, n: number): number {
  return u * n + v;
}

function triKey(u: number, v: number, w: number, n: number): number {
  return (u * n + v) * n + w;
}

export function buildRipsComplex(
  points: Points,
  dims: number,
  maxDist: number,
  maxDim: number = 2,
): RipsComplex {
  const n = points.length / dims;
  const dist = computePairwiseDistances(points, dims, n);

  // ── Build edges ──
  const tempEdges: TempEdge[] = [];
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = lookupDist(dist, i, j);
      if (d <= maxDist) {
        tempEdges.push({ u: i, v: j, val: d, origIdx: adj[i]!.length });
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }
  }

  tempEdges.sort((a, b) => a.val - b.val || a.origIdx - b.origIdx);

  const edges: EdgeEntry[] = tempEdges.map(e => ({ u: e.u, v: e.v, val: e.val }));
  // Dense u*n+v keyspace -> flat Int32Array lookup instead of Map<number,number>.
  // Always queried with u < v (matches insertion order below), so no
  // symmetric fill is needed. Same values as the Map version, just O(1)
  // direct indexing instead of hashing -- this is on the hot path, called
  // 2-3x per triangle candidate.
  const edgeIndex = new Int32Array(n * n).fill(-1);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    edgeIndex[e.u * n + e.v] = i;
  }

  for (let v = 0; v < n; v++) {
    adj[v]!.sort((a, b) => a - b);
  }

  // ── Build bit-vector adjacency ──
  const words = Math.ceil(n / 32);
  const adjBits: Uint32Array[] = new Array(n);
  for (let v = 0; v < n; v++) {
    const bits = new Uint32Array(words);
    const nbors = adj[v]!;
    for (let k = 0; k < nbors.length; k++) {
      bits[nbors[k]! >>> 5]! |= 1 << (nbors[k]! & 31);
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

        const dik = lookupDist(dist, u, k);
        const djk = lookupDist(dist, v, k);
        const birth = Math.max(dij, dik, djk);
        triangles.push({
          edges: [
            // (u, v) is exactly the current outer-loop edge -- ei is already
            // its index, no lookup needed (was a redundant Map.get before).
            ei,
            edgeIndex[u * n + k]!,
            edgeIndex[v * n + k]!,
          ],
          verts: [u, v, k],
          val: birth,
        });
      }
    }
  }

  triangles.sort((a, b) => a.val - b.val);

  // ── Build vertex→triangle index map ──
  const triMap = new Map<number, number>();
  for (let ti = 0; ti < triangles.length; ti++) {
    const [tu, tv, tw] = triangles[ti]!.verts;
    triMap.set(triKey(tu, tv, tw, n), ti);
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

          const dux = lookupDist(dist, su, x);
          const dvx = lookupDist(dist, sv, x);
          const dwx = lookupDist(dist, sw, x);
          const birth = Math.max(triVal, dux, dvx, dwx);

          tetrahedra.push({
            triangles: [
              triMap.get(triKey(sv, sw, x, n))!,
              triMap.get(triKey(su, sw, x, n))!,
              triMap.get(triKey(su, sv, x, n))!,
              ti,
            ],
            val: birth,
          });
        }
      }
    }

    tetrahedra.sort((a, b) => a.val - b.val);
  }

  return { n, edges, triangles, tetrahedra };
}

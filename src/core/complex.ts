import type { Points } from "./distance.ts";
import type { EdgeEntry } from "./h0.ts";
import { stableSortByVal } from "./radix-sort.ts";
import { buildRipsSkeleton } from "./rips-skeleton.ts";

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

export interface RipsComplex {
  n: number;
  edges: EdgeEntry[];
  triangles: TriangleEntry[];
  tetrahedra: TetraEntry[];

  /** Bit-vector adjacency (n words of ceil(n/32) Uint32). */
  adjBits?: Uint32Array[];
  /** Maps packed vertex-key (u*n+v)*n+w → triangle index. */
  triMap?: Map<number, number>;
}

function triKey(u: number, v: number, w: number, n: number): number {
  return (u * n + v) * n + w;
}

export function buildRipsComplex(
  points: Points,
  dims: number,
  maxDist: number,
  maxDim = 2,
  epsilon?: number
): RipsComplex {
  const skeleton = buildRipsSkeleton(points, dims, maxDist, {
    collapseMaxDim: maxDim,
    epsilon,
  });
  const { adjBits, edgeIndex, edges, n } = skeleton;
  const words = Math.ceil(n / 32);
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

        const ukIdx = edgeIndex(u, k);
        const vkIdx = edgeIndex(v, k);
        const birth = Math.max(dij, edges[ukIdx]!.val, edges[vkIdx]!.val);
        triangles.push({
          edges: [ei, ukIdx, vkIdx],
          val: birth,
          verts: [u, v, k],
        });
      }
    }
  }

  stableSortByVal(triangles);

  const triMapExposed = new Map<number, number>();
  for (let ti = 0; ti < triangles.length; ti++) {
    const [tu, tv, tw] = triangles[ti]!.verts;
    triMapExposed.set(triKey(tu, tv, tw, n), ti);
  }

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

          const birth = Math.max(
            triVal,
            edges[edgeIndex(su, x)]!.val,
            edges[edgeIndex(sv, x)]!.val,
            edges[edgeIndex(sw, x)]!.val
          );
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

    stableSortByVal(tetrahedra);
  }

  return {
    adjBits,
    edges,
    n,
    tetrahedra,
    triMap: triMapExposed,
    triangles,
  };
}

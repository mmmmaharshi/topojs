import { CombinatorialIndex } from "./combinatorial-index.ts";
import type { Points } from "./distance.ts";
import type { EdgeEntry } from "./h0.ts";
import { buildRipsSkeleton } from "./rips-skeleton.ts";

export interface ImplicitRipsComplex {
  n: number;
  maxDist: number;
  edges: EdgeEntry[];
  adjBits: Uint32Array[];
  edgeValue: (u: number, v: number) => number;
  triangleRank: (u: number, v: number, w: number) => number;
  tetrahedronRank: (a: number, b: number, c: number, d: number) => number;
  triangleValueByRank: (rank: number) => number;
  tetrahedronValueByRank: (rank: number) => number;
}

export function buildImplicitRipsComplex(
  points: Points,
  dims: number,
  maxDist: number,
  epsilon?: number
): ImplicitRipsComplex {
  const skeleton = buildRipsSkeleton(points, dims, maxDist, {
    collapseMaxDim: 2,
    epsilon,
  });
  const combinatorialIndex = new CombinatorialIndex(skeleton.n);
  const triangleValue = (u: number, v: number, w: number): number =>
    Math.max(
      skeleton.edgeValue(u, v),
      skeleton.edgeValue(u, w),
      skeleton.edgeValue(v, w)
    );
  const tetrahedronValue = (
    a: number,
    b: number,
    c: number,
    d: number
  ): number =>
    Math.max(
      triangleValue(a, b, c),
      triangleValue(a, b, d),
      triangleValue(a, c, d),
      triangleValue(b, c, d)
    );

  return {
    adjBits: skeleton.adjBits,
    edgeValue: skeleton.edgeValue,
    edges: skeleton.edges,
    maxDist: skeleton.maxDist,
    n: skeleton.n,
    tetrahedronRank: (a, b, c, d) => combinatorialIndex.rank4(a, b, c, d),
    tetrahedronValueByRank: (rank) => {
      const [a, b, c, d] = combinatorialIndex.unrank4(rank);
      return tetrahedronValue(a, b, c, d);
    },
    triangleRank: (u, v, w) => combinatorialIndex.rank(u, v, w),
    triangleValueByRank: (rank) => {
      const [u, v, w] = combinatorialIndex.unrank(rank);
      return triangleValue(u, v, w);
    },
  };
}

export function triVal(
  complex: ImplicitRipsComplex,
  u: number,
  v: number,
  w: number
): number {
  return Math.max(
    complex.edgeValue(u, v),
    complex.edgeValue(u, w),
    complex.edgeValue(v, w)
  );
}

export function triValByRank(
  complex: ImplicitRipsComplex,
  rank: number
): number {
  return complex.triangleValueByRank(rank);
}

export function tetVal(
  complex: ImplicitRipsComplex,
  a: number,
  b: number,
  c: number,
  d: number
): number {
  const dab = complex.edgeValue(a, b);
  const dac = complex.edgeValue(a, c);
  const dad = complex.edgeValue(a, d);
  const dbc = complex.edgeValue(b, c);
  const dbd = complex.edgeValue(b, d);
  const dcd = complex.edgeValue(c, d);
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
  return complex.tetrahedronValueByRank(rank);
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

import type { Points } from "../src/core/distance.ts";

/** Build a flattened Points array from an array of [x, y] tuples. */
export function generatePoints(pts: [number, number][]): Points {
  const flat = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i]!;
    flat[i * 2] = px;
    flat[i * 2 + 1] = py;
  }
  return flat;
}

/** n points evenly spaced on a circle of given radius, centered at (cx, cy). */
export function circlePoints(n: number, radius = 1, cx = 0, cy = 0): Points {
  const flat = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    flat[i * 2] = cx + radius * Math.cos(a);
    flat[i * 2 + 1] = cy + radius * Math.sin(a);
  }
  return flat;
}

/**
 * Deterministic PRNG (mulberry32) so "random" tests are reproducible across
 * runs/machines — a Math.random()-seeded test that fails is undebuggable
 * and unreproducible, which is not acceptable for a peer-reviewed artifact.
 */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function mulberry32Impl(): number {
    a |= 0;
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function countByDim(pairs: { dim: number }[], dim: number): number {
  return pairs.filter((p) => p.dim === dim).length;
}

/**
 * Euler–Poincaré sanity check: for a simplicial complex truncated at
 * dimension d, chi = sum (-1)^k * (#k-simplices) must equal
 * sum (-1)^k * betti_k, PROVIDED every homology group up to dimension d
 * is actually computed (no truncated/uncomputed top dimension). Callers
 * are responsible for only invoking this where that precondition holds
 * (see comments at each call site — in particular, this library only
 * computes H0-H2, so any config with an essential H3 class will make
 * this check disagree by exactly -b3, which is a documented scope
 * limitation rather than a bug).
 */
export function eulerCheck(res: {
  pairs: { dim: number; death: number }[];
  complex: {
    numVertices: number;
    numEdges: number;
    numTriangles: number;
    numTetrahedra: number;
  };
}): {
  chiSimplicial: number;
  chiBetti: number;
  b0: number;
  b1: number;
  b2: number;
} {
  const {
    numVertices: V,
    numEdges: E,
    numTriangles: T,
    numTetrahedra: Tet,
  } = res.complex;
  const chiSimplicial = V - E + T - Tet;
  const b0 = res.pairs.filter((p) => p.dim === 0 && p.death < 0).length;
  const b1 = res.pairs.filter((p) => p.dim === 1 && p.death < 0).length;
  const b2 = res.pairs.filter((p) => p.dim === 2 && p.death < 0).length;
  const chiBetti = b0 - b1 + b2;
  return { b0, b1, b2, chiBetti, chiSimplicial };
}

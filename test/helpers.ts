import type { Points } from "../src/core/distance.ts";
import { enclosingRadius } from "../src/core/distance.ts";
import { referenceRipsBarcode } from "./barcode-reference.ts";

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

export interface TestPersistencePair {
  birth: number;
  death: number;
  dim: number;
}

export function canonicalizePairs(
  pairs: readonly TestPersistencePair[]
): string {
  return JSON.stringify(
    pairs
      .map((pair) => ({ birth: pair.birth, death: pair.death, dim: pair.dim }))
      .toSorted(
        (first, second) =>
          first.dim - second.dim ||
          first.birth - second.birth ||
          first.death - second.death
      )
  );
}

export function samePersistencePairs(
  first: readonly TestPersistencePair[],
  second: readonly TestPersistencePair[]
): boolean {
  return canonicalizePairs(first) === canonicalizePairs(second);
}

export function randomPoints(
  rng: () => number,
  n: number,
  dims: number,
  scale = 1
): Points {
  const points = new Float64Array(n * dims);
  for (let index = 0; index < points.length; index++) {
    points[index] = rng() * scale;
  }
  return points;
}

export function seededPoints(
  seed: number,
  n: number,
  dims: number,
  scale = 1
): Points {
  return randomPoints(mulberry32(seed), n, dims, scale);
}

export interface SmallDifferentialTrial {
  actual: readonly TestPersistencePair[];
  expected: ReturnType<typeof referenceRipsBarcode>;
  matches: boolean;
  points: Points;
}

export function runSmallDifferentialTrial(
  seed: number,
  n: number,
  dims: number,
  maxDist: number,
  run: (
    points: Points,
    dims: number,
    maxDist: number
  ) => readonly TestPersistencePair[],
  maxHomologyDim = 2,
  scale = 1
): SmallDifferentialTrial {
  const points = randomPoints(mulberry32(seed), n, dims, scale);
  const actual = run(points, dims, maxDist);
  const expected = referenceRipsBarcode(points, dims, maxDist, maxHomologyDim);
  return {
    actual,
    expected,
    matches: samePersistencePairs(actual, expected),
    points,
  };
}

export function countByDim(pairs: { dim: number }[], dim: number): number {
  return pairs.filter((p) => p.dim === dim).length;
}

/**
 * Independent brute-force TETRAHEDRA count of the full flag complex:
 * 4-tuples with all six pairs within the effective threshold (same
 * squared-domain predicate and enclosing-radius cap as above). For the
 * incremental engine's uncollapsed complex stats.
 */
export function bruteForceTetraCount(
  points: Points,
  dims: number,
  maxDist: number
): number {
  const n = points.length / dims;
  let effectiveMaxDist = maxDist;
  if (maxDist > 0 && !Number.isFinite(maxDist)) {
    const r = enclosingRadius(points, dims);
    if (r < effectiveMaxDist) {
      effectiveMaxDist = r;
    }
  }
  const maxDistSq = effectiveMaxDist * effectiveMaxDist;
  const sqDist = (i: number, j: number): number => {
    const bi = i * dims;
    const bj = j * dims;
    let sq = 0;
    for (let d = 0; d < dims; d++) {
      const diff = points[bi + d]! - points[bj + d]!;
      sq += diff * diff;
    }
    return sq;
  };
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sqDist(i, j) > maxDistSq) {
        continue;
      }
      for (let k = j + 1; k < n; k++) {
        if (sqDist(i, k) > maxDistSq || sqDist(j, k) > maxDistSq) {
          continue;
        }
        for (let l = k + 1; l < n; l++) {
          if (
            sqDist(i, l) <= maxDistSq &&
            sqDist(j, l) <= maxDistSq &&
            sqDist(k, l) <= maxDistSq
          ) {
            count++;
          }
        }
      }
    }
  }
  return count;
}

/**
 * Independent brute-force TRIANGLE count of the full flag complex: triples
 * with all three pairs within the effective threshold (same squared-domain
 * predicate and enclosing-radius cap as bruteForceEdgeCount). Lets tests
 * compare reduced/incremental-engine triangle counts against the
 * uncollapsed full complex, which the collapsed builders no longer report.
 */
export function bruteForceTriangleCount(
  points: Points,
  dims: number,
  maxDist: number
): number {
  const n = points.length / dims;
  let effectiveMaxDist = maxDist;
  if (maxDist > 0 && !Number.isFinite(maxDist)) {
    const r = enclosingRadius(points, dims);
    if (r < effectiveMaxDist) {
      effectiveMaxDist = r;
    }
  }
  const maxDistSq = effectiveMaxDist * effectiveMaxDist;
  const sqDist = (i: number, j: number): number => {
    const bi = i * dims;
    const bj = j * dims;
    let sq = 0;
    for (let d = 0; d < dims; d++) {
      const diff = points[bi + d]! - points[bj + d]!;
      sq += diff * diff;
    }
    return sq;
  };
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sqDist(i, j) > maxDistSq) {
        continue;
      }
      for (let k = j + 1; k < n; k++) {
        if (sqDist(i, k) <= maxDistSq && sqDist(j, k) <= maxDistSq) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Independent brute-force edge count replicating the builders' threshold
 * predicate EXACTLY (squared-domain compare against the effective maxDist,
 * including the enclosing-radius cap for unbounded maxDist), but WITHOUT
 * edge-collapse. Engines that keep the full 1-skeleton (reduced,
 * incremental) report this count, while the collapsed builders report
 * fewer -- both are correct; this helper lets differential tests compare
 * each side against its own expected value.
 */
export function bruteForceEdgeCount(
  points: Points,
  dims: number,
  maxDist: number
): number {
  const n = points.length / dims;
  let effectiveMaxDist = maxDist;
  if (maxDist > 0 && !Number.isFinite(maxDist)) {
    const r = enclosingRadius(points, dims);
    if (r < effectiveMaxDist) {
      effectiveMaxDist = r;
    }
  }
  const maxDistSq = effectiveMaxDist * effectiveMaxDist;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bi = i * dims;
      const bj = j * dims;
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = points[bi + d]! - points[bj + d]!;
        sq += diff * diff;
      }
      if (sq <= maxDistSq) {
        count++;
      }
    }
  }
  return count;
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

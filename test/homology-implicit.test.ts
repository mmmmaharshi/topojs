import { describe, it, expect } from "vitest";

import { computePersistentHomologyCohomology } from "../src/core/homology-cohom.ts";
import { computePersistentHomologyImplicit } from "../src/core/homology-implicit.ts";
import { mulberry32 } from "./helpers.ts";

function randomPoints(
  rng: () => number,
  n: number,
  dims: number
): Float64Array {
  const pts = new Float64Array(n * dims);
  for (let i = 0; i < n * dims; i++) {
    pts[i] = rng() * 10;
  }
  return pts;
}

function sortPairs(
  pairs: { birth: number; death: number; dim: number }[]
): { birth: number; death: number; dim: number }[] {
  return [...pairs].toSorted((a, b) => {
    if (a.dim !== b.dim) {
      return a.dim - b.dim;
    }
    if (a.birth !== b.birth) {
      return a.birth - b.birth;
    }
    return a.death - b.death;
  });
}

describe("computePersistentHomologyImplicit vs computePersistentHomologyCohomology", () => {
  const seeds = Array.from({ length: 500 }, (_, i) => i * 13 + 7);

  it.each(seeds)(
    `seed=%i: H1 pairs match cohomology engine exactly`,
    (seed) => {
      const rng = mulberry32(seed);
      const n = 5 + Math.floor(rng() * 26);
      const dims = 2 + Math.floor(rng() * 4);
      const pts = randomPoints(rng, n, dims);

      const maxDistCandidates = [0.5, 1, 2, 3, 5, 8, Infinity];
      const maxDist =
        maxDistCandidates[Math.floor(rng() * maxDistCandidates.length)]!;

      const cohomResult = computePersistentHomologyCohomology(
        pts,
        dims,
        maxDist,
        2
      );
      const implicitResult = computePersistentHomologyImplicit(
        pts,
        dims,
        maxDist,
        2
      );

      const cohomPairs = sortPairs(
        cohomResult.pairs.filter((p) => p.dim !== 2)
      );
      const implicitPairs = sortPairs(
        implicitResult.pairs.filter((p) => p.dim !== 2)
      );

      expect(implicitPairs).toStrictEqual(cohomPairs);
    }
  );

  it.each(seeds)(
    `seed=%i: H2 pairs match cohomology engine exactly`,
    (seed) => {
      const rng = mulberry32(seed);
      const n = 5 + Math.floor(rng() * 26);
      const dims = 2 + Math.floor(rng() * 4);
      const pts = randomPoints(rng, n, dims);

      const maxDistCandidates = [0.5, 1, 2, 3, 5, 8, Infinity];
      const maxDist =
        maxDistCandidates[Math.floor(rng() * maxDistCandidates.length)]!;

      const cohomResult = computePersistentHomologyCohomology(
        pts,
        dims,
        maxDist,
        3
      );
      const implicitResult = computePersistentHomologyImplicit(
        pts,
        dims,
        maxDist,
        3
      );

      const cohomPairs = sortPairs(
        cohomResult.pairs.filter((p) => p.dim === 2)
      );
      const implicitPairs = sortPairs(
        implicitResult.pairs.filter((p) => p.dim === 2)
      );

      expect(implicitPairs).toStrictEqual(cohomPairs);
    }
  );
});

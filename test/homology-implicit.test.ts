import { describe, it, expect } from "vitest";

import { computePersistentHomologyCohomology } from "../src/core/homology-cohom.ts";
import { computePersistentHomologyImplicit } from "../src/core/homology-implicit.ts";
import { referenceRipsBarcode } from "./barcode-reference.ts";
import { mulberry32, randomPoints, samePersistencePairs } from "./helpers.ts";

describe("computePersistentHomologyImplicit vs computePersistentHomologyCohomology", () => {
  const seeds = Array.from({ length: 500 }, (_, i) => i * 13 + 7);

  it.each(seeds)(
    `seed=%i: H1 pairs match cohomology engine exactly`,
    (seed) => {
      const rng = mulberry32(seed);
      const n = 5 + Math.floor(rng() * 26);
      const dims = 2 + Math.floor(rng() * 4);
      const pts = randomPoints(rng, n, dims, 10);

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
        1
      );

      const cohomPairs = cohomResult.pairs.filter((p) => p.dim !== 2);
      const implicitPairs = implicitResult.pairs.filter((p) => p.dim !== 2);
      const expected =
        n <= 8 ? referenceRipsBarcode(pts, dims, maxDist, 1) : cohomPairs;

      expect(samePersistencePairs(cohomPairs, expected)).toBeTruthy();
      expect(samePersistencePairs(implicitPairs, expected)).toBeTruthy();
    }
  );

  it.each(seeds)(
    `seed=%i: H2 pairs match cohomology engine exactly`,
    (seed) => {
      const rng = mulberry32(seed);
      const n = 5 + Math.floor(rng() * 26);
      const dims = 2 + Math.floor(rng() * 4);
      const pts = randomPoints(rng, n, dims, 10);

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
        2
      );

      const cohomPairs = cohomResult.pairs.filter((p) => p.dim === 2);
      const implicitPairs = implicitResult.pairs.filter((p) => p.dim === 2);
      const expected =
        n <= 8
          ? referenceRipsBarcode(pts, dims, maxDist, 2).filter(
              (pair) => pair.dim === 2
            )
          : cohomPairs;

      expect(samePersistencePairs(cohomPairs, expected)).toBeTruthy();
      expect(samePersistencePairs(implicitPairs, expected)).toBeTruthy();
    }
  );
});

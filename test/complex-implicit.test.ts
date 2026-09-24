import { describe, it, expect } from "vitest";

import { CombinatorialIndex } from "../src/core/combinatorial-index.ts";
import {
  buildImplicitRipsComplex,
  countImplicitTriangles,
} from "../src/core/complex-implicit.ts";
import { buildRipsComplex } from "../src/core/complex.ts";
import { mulberry32, randomPoints } from "./helpers.ts";

describe("buildImplicitRipsComplex vs buildRipsComplex", () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i * 7 + 13);

  /* eslint-disable-next-line vitest/prefer-each */
  for (const seed of seeds) {
    it(`seed=${seed}: triangle count and filtration values match`, () => {
      const rng = mulberry32(seed);
      const n = 5 + Math.floor(rng() * 26); // 5..30
      const dims = 2 + Math.floor(rng() * 4); // 2..5
      const pts = randomPoints(rng, n, dims, 10);

      const maxDistCandidates = [0.5, 1, 2, 3, 5, 8, Infinity];
      const maxDist =
        maxDistCandidates[Math.floor(rng() * maxDistCandidates.length)]!;

      const materialized = buildRipsComplex(pts, dims, maxDist, 2);
      const implicit = buildImplicitRipsComplex(pts, dims, maxDist);

      const implicitCount = countImplicitTriangles(implicit, maxDist);
      expect(implicitCount).toBe(materialized.triangles.length);

      const ci = new CombinatorialIndex(n);
      for (const tri of materialized.triangles) {
        const [u, v, w] = tri.verts;
        const rank = ci.rank(u, v, w);
        const implicitVal = implicit.triangleValueByRank(rank);
        expect(implicitVal).toBe(tri.val);
      }
    });
  }
});

import { describe, it, expect } from "vitest";

import { CombinatorialIndex } from "../src/core/combinatorial-index.ts";
import {
  buildImplicitRipsComplex,
  triValByRank,
  countImplicitTriangles,
} from "../src/core/complex-implicit.ts";
import { buildRipsComplex } from "../src/core/complex.ts";
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

describe("buildImplicitRipsComplex vs buildRipsComplex", () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i * 7 + 13);

  /* eslint-disable-next-line vitest/prefer-each */
  for (const seed of seeds) {
    it(`seed=${seed}: triangle count and filtration values match`, () => {
      const rng = mulberry32(seed);
      const n = 5 + Math.floor(rng() * 26); // 5..30
      const dims = 2 + Math.floor(rng() * 4); // 2..5
      const pts = randomPoints(rng, n, dims);

      const maxDistCandidates = [0.5, 1, 2, 3, 5, 8, Infinity];
      const maxDist =
        maxDistCandidates[Math.floor(rng() * maxDistCandidates.length)]!;

      const materialized = buildRipsComplex(pts, dims, maxDist, 2);
      const implicit = buildImplicitRipsComplex(pts, dims, maxDist);

      expect(implicit.n).toBe(materialized.n);
      expect(implicit.edges.map((e) => e.val)).toStrictEqual(
        materialized.edges.map((e) => e.val)
      );

      const implicitCount = countImplicitTriangles(implicit, maxDist);
      expect(implicitCount).toBe(materialized.triangles.length);

      const ci = new CombinatorialIndex(n);
      for (const tri of materialized.triangles) {
        const [u, v, w] = tri.verts;
        const rank = ci.rank(u, v, w);
        const implicitVal = triValByRank(implicit, rank);
        expect(implicitVal).toBe(tri.val);
      }
    });
  }

  it("edge bits match between implicit and materialized", () => {
    const rng = mulberry32(42);
    const pts = randomPoints(rng, 15, 3);
    const maxDist = 3;

    const materialized = buildRipsComplex(pts, 3, maxDist, 2);
    const implicit = buildImplicitRipsComplex(pts, 3, maxDist);

    expect(implicit.adjBits).toHaveLength(materialized.adjBits!.length);
    for (let v = 0; v < implicit.n; v++) {
      const ib = implicit.adjBits[v]!;
      const mb = materialized.adjBits![v]!;
      expect(ib).toHaveLength(mb.length);
      for (let w = 0; w < ib.length; w++) {
        expect(ib[w]).toBe(mb[w]);
      }
    }
  });
});

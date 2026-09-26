import { describe, expect, it } from "vitest";

import { computePersistentHomologyAdvanced } from "../src/core/homology-unified.ts";
import { referenceRipsBarcode } from "./barcode-reference.ts";
import { mulberry32, randomPoints, samePersistencePairs } from "./helpers.ts";

describe("independent Rips barcode reference", () => {
  it("matches a literal disconnected H0 barcode", () => {
    const points = new Float64Array([0, 0, 1, 0, 10, 0]);
    expect(referenceRipsBarcode(points, 2, 1.5, 0)).toStrictEqual([
      { birth: 0, death: -1, dim: 0 },
      { birth: 0, death: -1, dim: 0 },
      { birth: 0, death: 1, dim: 0 },
    ]);
  });

  it("matches a literal square loop barcode", () => {
    const points = new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(referenceRipsBarcode(points, 2, 1.1, 2)).toStrictEqual([
      { birth: 0, death: -1, dim: 0 },
      { birth: 0, death: 1, dim: 0 },
      { birth: 0, death: 1, dim: 0 },
      { birth: 0, death: 1, dim: 0 },
      { birth: 1, death: -1, dim: 1 },
    ]);
  });

  it("does not emit zero-persistence H1 pairs", () => {
    const points = new Float64Array([0, 0, 1, 0, 0, 1]);
    expect(referenceRipsBarcode(points, 2, 1, 2)).toStrictEqual([
      { birth: 0, death: -1, dim: 0 },
      { birth: 0, death: 1, dim: 0 },
      { birth: 0, death: 1, dim: 0 },
    ]);
  });

  it("matches a literal essential H2 octahedron barcode", () => {
    const points = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    expect(referenceRipsBarcode(points, 3, Math.SQRT2 + 0.01, 2)).toStrictEqual(
      [
        { birth: 0, death: -1, dim: 0 },
        { birth: 0, death: Math.SQRT2, dim: 0 },
        { birth: 0, death: Math.SQRT2, dim: 0 },
        { birth: 0, death: Math.SQRT2, dim: 0 },
        { birth: 0, death: Math.SQRT2, dim: 0 },
        { birth: 0, death: Math.SQRT2, dim: 0 },
        { birth: Math.SQRT2, death: -1, dim: 2 },
      ]
    );
  });

  it("matches the production engine on small seeded H0/H1/H2 clouds", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = mulberry32(seed);
      const n = 3 + Math.floor(rng() * 6);
      const dims = 2 + Math.floor(rng() * 2);
      const points = randomPoints(rng, n, dims, 10);
      const maxDist = [0.5, 1, 2, 5, Infinity][Math.floor(rng() * 5)]!;
      for (let maxHomologyDim = 0; maxHomologyDim <= 2; maxHomologyDim++) {
        const actual = computePersistentHomologyAdvanced(points, dims, {
          engine: "standard",
          maxDim: maxHomologyDim,
          maxDist,
        }).pairs;
        const expected = referenceRipsBarcode(
          points,
          dims,
          maxDist,
          maxHomologyDim
        );
        expect(
          samePersistencePairs(actual, expected),
          `seed=${seed}, n=${n}, dims=${dims}, maxDist=${maxDist}, maxDim=${maxHomologyDim}`
        ).toBeTruthy();
      }
    }
  });
});

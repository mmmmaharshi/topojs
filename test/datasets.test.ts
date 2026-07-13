/* eslint-disable typescript/prefer-for-of */
import { describe, it, expect } from "vitest";

import { computeCubicalHomology } from "../src/core/cubical.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import {
  loadMNISTDigits,
  loadIrisDataset,
  generateTerrain,
} from "../src/data/realworld-datasets.ts";

describe("real-world datasets", () => {
  it("MNIST — 10 digits load, cubical homology runs on digit 0", () => {
    const digits = loadMNISTDigits();
    expect(digits).toHaveLength(10);
    expect(digits[0]!.pixels).toHaveLength(784);
    expect(digits[0]!.label).toBe(7);
    const r = computeCubicalHomology(digits[3]!.pixels, 28, 28, 1);
    expect(r.pairs.length).toBeGreaterThan(0);
    expect(r.dims).toStrictEqual({ height: 28, width: 28 });
  });

  it("Iris — 150x4 loads, Rips persistence runs", () => {
    const iris = loadIrisDataset();
    expect(iris).toHaveLength(150 * 4);
    const r = computePersistentHomology(iris, 4, 1, 2);
    expect(r.pairs.length).toBeGreaterThan(0);
    expect(r.complex.numVertices).toBe(150);
  });

  // generateTerrain had zero direct test coverage before this block -- found
  // during a codebase audit (it's the only exported dataset loader/generator
  // with no tests at all). It's a fractal-Brownian-motion procedural
  // generator built on a module-level seeded PRNG shared with
  // generateTorus3D/generateSphere3D/generateMNISTLike/generatePointCloud1D,
  // but each of those (including this one) calls resetSeed() with its own
  // hardcoded value as the first thing it does, so results are deterministic
  // per-function regardless of call order or what ran before it -- these
  // tests lock that invariant in too, not just output shape/bounds.
  describe(generateTerrain, () => {
    it("default size/octaves -> 64x64 heightmap, values in [0,255]", () => {
      const terrain = generateTerrain();
      expect(terrain).toHaveLength(64 * 64);
      for (let i = 0; i < terrain.length; i++) {
        expect(terrain[i]!, `index ${i}`).toBeGreaterThanOrEqual(0);
        expect(terrain[i]!, `index ${i}`).toBeLessThanOrEqual(255);
      }
    });

    it("output length always matches size*size, for several (size, octaves) combinations", () => {
      const cases: [number, number][] = [
        [8, 1],
        [16, 3],
        [32, 6],
        [10, 4],
      ];
      for (const [size, octaves] of cases) {
        const terrain = generateTerrain(size, octaves);
        expect(terrain, `size=${size} octaves=${octaves}`).toHaveLength(
          size * size
        );
        for (let i = 0; i < terrain.length; i++) {
          expect(terrain[i]!).toBeGreaterThanOrEqual(0);
          expect(terrain[i]!).toBeLessThanOrEqual(255);
        }
      }
    });

    it("is deterministic: two calls with identical args produce byte-identical output", () => {
      const a = generateTerrain(16, 4);
      const b = generateTerrain(16, 4);
      expect([...a]).toStrictEqual([...b]);
    });

    it("is deterministic regardless of what ran before it (shared-PRNG isolation)", () => {
      // Calls another generator sharing the same module-level seededRandom()
      // between the two generateTerrain() calls -- if generateTerrain didn't
      // reset its own seed internally, this would perturb the second call's
      // output relative to the first.
      const a = generateTerrain(12, 3);
      loadIrisDataset(); // unrelated call, doesn't touch the shared PRNG, but
      generateTerrain(20, 5); // this one DOES consume seededRandom() calls
      const b = generateTerrain(12, 3);
      expect([...a]).toStrictEqual([...b]);
    });

    it("cubical homology runs on generated terrain without error", () => {
      const terrain = generateTerrain(10, 3);
      const res = computeCubicalHomology(terrain, 10, 10, 1);
      expect(res.pairs.length).toBeGreaterThan(0);
      expect(res.dims).toStrictEqual({ height: 10, width: 10 });
    });

    it("more octaves changes the output (not a no-op parameter)", () => {
      const low = generateTerrain(16, 1);
      const high = generateTerrain(16, 6);
      expect([...low]).not.toStrictEqual([...high]);
    });
  });
});

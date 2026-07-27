import { describe, it, expect } from "vitest";

import { computeCubicalHomology } from "../src/core/cubical.ts";
import { generateTerrain } from "../src/data/realworld-datasets.ts";

describe("real-world datasets", () => {
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
        for (const v of terrain) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
    });

    it("is deterministic: two calls with identical args produce byte-identical output", () => {
      const a = generateTerrain(16, 4);
      const b = generateTerrain(16, 4);
      expect([...a]).toStrictEqual([...b]);
    });

    it("is deterministic regardless of what ran before it (shared-PRNG isolation)", () => {
      const a = generateTerrain(12, 3);
      generateTerrain(20, 5);
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

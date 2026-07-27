import { describe, it, expect } from "vitest";
import { CombinatorialIndex } from "../src/core/combinatorial-index.ts";

function C(n: number, k: number): number {
  if (k === 0) return 1;
  if (k === 1) return n;
  if (k === 2) return (n * (n - 1)) / 2;
  if (k === 3) return (n * (n - 1) * (n - 2)) / 6;
  return 0;
}

function* enumerateTriangles(n: number): Generator<[number, number, number]> {
  for (let w = 2; w < n; w++) {
    for (let v = 1; v < w; v++) {
      for (let u = 0; u < v; u++) {
        yield [u, v, w];
      }
    }
  }
}

describe("CombinatorialIndex", () => {
  describe("bijection, n ≤ 30", () => {
    for (const n of [5, 10, 15, 20, 25, 30]) {
      it(`n=${n}: ranks are exactly [0, C(${n},3)) with no gaps or duplicates`, () => {
        const idx = new CombinatorialIndex(n);
        const total = C(n, 3);
        const seen = new Set<number>();
        for (const [u, v, w] of enumerateTriangles(n)) {
          seen.add(idx.rank(u, v, w));
        }
        expect(seen.size).toBe(total);
        expect(Math.max(...seen)).toBe(total - 1);
        expect(Math.min(...seen)).toBe(0);
      });
    }
  });

  describe("round-trip", () => {
    for (const n of [5, 10, 15, 20]) {
      it(`n=${n}: unrank(rank(u,v,w)) === (u,v,w) and rank(unrank(r)) === r`, () => {
        const idx = new CombinatorialIndex(n);
        for (const [u, v, w] of enumerateTriangles(n)) {
          const r = idx.rank(u, v, w);
          expect(idx.unrank(r)).toStrictEqual([u, v, w]);
        }
        for (let r = 0; r < idx.maxRank; r++) {
          const [u, v, w] = idx.unrank(r);
          expect(idx.rank(u, v, w)).toBe(r);
        }
      });
    }
  });

  describe("monotonicity", () => {
    it("ranks are strictly increasing in colex order", () => {
      const n = 20;
      const idx = new CombinatorialIndex(n);
      let prev = -1;
      for (const triple of enumerateTriangles(n)) {
        const r = idx.rank(triple[0], triple[1], triple[2]);
        expect(r).toBeGreaterThan(prev);
        prev = r;
      }
    });
  });

  describe("degenerate n", () => {
    for (const n of [0, 1, 2]) {
      it(`n=${n} does not throw and produces zero triangles`, () => {
        expect(() => new CombinatorialIndex(n)).not.toThrow();
        const idx = new CombinatorialIndex(n);
        expect(idx.maxRank).toBe(0);
        expect(idx.n).toBe(n);
      });
    }

    it("n=3 produces exactly one triangle, rank 0", () => {
      const idx = new CombinatorialIndex(3);
      expect(idx.maxRank).toBe(1);
      expect(idx.rank(0, 1, 2)).toBe(0);
      expect(idx.unrank(0)).toStrictEqual([0, 1, 2]);
    });
  });

  describe("boundary ranks", () => {
    for (const n of [10, 50, 200, 2000]) {
      it(`unrank(0) = (0,1,2) and unrank(C(${n},3)-1) = (${n - 3},${n - 2},${n - 1})`, () => {
        const idx = new CombinatorialIndex(n);
        expect(idx.unrank(0)).toStrictEqual([0, 1, 2]);
        expect(idx.unrank(idx.maxRank - 1)).toStrictEqual([
          n - 3,
          n - 2,
          n - 1,
        ]);
      });
    }
  });

  describe("n ≥ 2300 throws", () => {
    for (const n of [2300, 2345, 5000, 10000]) {
      it(`n=${n} throws`, () => {
        expect(() => new CombinatorialIndex(n)).toThrow();
      });
    }
  });
});

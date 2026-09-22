/* eslint-disable vitest/expect-expect */
import { describe, it, expect } from "vitest";

import { stableSortByVal } from "../src/core/radix-sort.ts";
import { mulberry32 } from "./helpers.ts";

interface ValBox {
  id: number;
  val: number;
}

function boxes(vals: number[]): ValBox[] {
  return vals.map((val, id) => ({ id, val }));
}

/** Reference: today's behavior, stable native comparator sort. */
function nativeSorted(arr: ValBox[]): ValBox[] {
  return arr.toSorted((a, b) => a.val - b.val);
}

/** Exact order equality: same vals in the same sequence AND same tie order. */
function expectIdentical(actual: ValBox[], expected: ValBox[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expect(actual[i]!.val).toBe(expected[i]!.val);
    expect(actual[i]!.id).toBe(expected[i]!.id);
  }
}

describe("stableSortByVal matches native stable sort exactly", () => {
  it("empty and singleton arrays", () => {
    const empty: ValBox[] = [];
    stableSortByVal(empty);
    expect(empty).toStrictEqual([]);
    const one = boxes([3]);
    stableSortByVal(one);
    expectIdentical(one, boxes([3]));
  });

  it("small array takes the native path with identical output", () => {
    const rng = mulberry32(7);
    const arr = boxes(Array.from({ length: 100 }, () => rng() * 10));
    const expected = nativeSorted(arr);
    stableSortByVal(arr);
    expectIdentical(arr, expected);
  });

  it("large random array with heavy ties (radix path)", () => {
    const rng = mulberry32(42);
    // Quantized to 50 distinct values over 20K elements: every value ties
    // ~400 ways, so tie-order fidelity is fully exercised.
    const arr = boxes(
      Array.from({ length: 20_000 }, () => Math.floor(rng() * 50) / 10)
    );
    const expected = nativeSorted(arr);
    stableSortByVal(arr);
    expectIdentical(arr, expected);
  });

  it("zeros, duplicates, and extreme magnitudes", () => {
    const vals = [0, 0, 5, 0, 1e-300, 1e300, 5, 1e-300, 0.1, 1e300, 2, 2, 2];
    const arr = boxes(vals);
    const expected = nativeSorted(arr);
    stableSortByVal(arr);
    expectIdentical(arr, expected);
  });

  it("already-sorted and reverse-sorted large arrays", () => {
    const n = 10_000;
    const asc = boxes(Array.from({ length: n }, (_, i) => i * 0.5));
    stableSortByVal(asc);
    expectIdentical(asc, boxes(Array.from({ length: n }, (_, i) => i * 0.5)));
    const desc = boxes(Array.from({ length: n }, (_, i) => (n - i) * 0.5));
    const expectedDesc = nativeSorted(desc);
    stableSortByVal(desc);
    expectIdentical(desc, expectedDesc);
  });

  it("all-equal values preserve insertion order", () => {
    const arr = boxes(Array.from({ length: 8000 }, () => 1.5));
    stableSortByVal(arr);
    for (let i = 0; i < arr.length; i++) {
      expect(arr[i]!.id).toBe(i);
    }
  });

  it("negative values fall back to native behavior (identical output)", () => {
    const rng = mulberry32(99);
    const arr = boxes(
      Array.from({ length: 9000 }, () => rng() * 20 - 10)
    );
    const expected = nativeSorted(arr);
    stableSortByVal(arr);
    expectIdentical(arr, expected);
  });

  it("threshold boundary sizes agree with native sort", () => {
    for (const n of [4095, 4096, 4097, 5000]) {
      const rng = mulberry32(n);
      const arr = boxes(Array.from({ length: n }, () => rng() * 100));
      const expected = nativeSorted(arr);
      stableSortByVal(arr);
      expectIdentical(arr, expected);
    }
  });
});

import { describe, it, expect } from "vitest";

import { HeapColumn } from "../src/core/heap-column.ts";
import { DenseWorkingCol } from "../src/core/reduction.ts";
import { mulberry32 } from "./helpers.ts";

describe("HeapColumn vs DenseWorkingCol on 500 random inputs", () => {
  const rng = mulberry32(20_260_727);

  /* eslint-disable-next-line vitest/prefer-each */
  for (let trial = 0; trial < 500; trial++) {
    it(`trial ${trial}: pivot sequence matches DenseWorkingCol`, () => {
      const maxIdx = 10 + Math.floor(rng() * 200);
      const colLen = 1 + Math.floor(rng() * Math.min(maxIdx, 60));

      const colSet = new Set<number>();
      while (colSet.size < colLen) {
        colSet.add(Math.floor(rng() * maxIdx));
      }
      const initialCol = new Int32Array(colSet);

      const dwc = new DenseWorkingCol(maxIdx);
      dwc.loadFromArray(initialCol);

      const hc = new HeapColumn((idx: number) => idx);
      hc.loadFromArray(initialCol);

      const dwcPivots: number[] = [];
      const hcPivots: number[] = [];
      let safety = 500;

      while (safety > 0) {
        safety--;
        const dp = dwc.pivot();
        const hp = hc.pivot();
        expect(dp).toBe(hp);
        if (dp < 0) {
          break;
        }
        dwcPivots.push(dp);
        hcPivots.push(hp);

        const current = [...dwc.toSparse()];
        const stored: number[] = [dp];
        for (const idx of current) {
          if (idx !== dp && rng() < 0.5) {
            stored.push(idx);
          }
        }
        const storedCol = new Int32Array(stored);

        dwc.xorSparse(storedCol);
        hc.xorSparse(storedCol);
      }

      expect(hcPivots).toStrictEqual(dwcPivots);
      expect(safety).toBeGreaterThan(0);
    });
  }
});

describe("HeapColumn standalone correctness", () => {
  it("starts empty", () => {
    const hc = new HeapColumn((idx: number) => idx);
    expect(hc.pivot()).toBe(-1);
    expect([...hc.toSparse()]).toStrictEqual([]);
  });

  it("loadFromNumbers sets entries, pivot returns max", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([2, 5, 7]);
    expect(hc.pivot()).toBe(7);
    expect([...hc.toSparse()]).toStrictEqual([2, 5, 7]);
  });

  it("loadFromArray behaves identically to loadFromNumbers", () => {
    const a = new HeapColumn((idx: number) => idx);
    const b = new HeapColumn((idx: number) => idx);
    a.loadFromNumbers([1, 4, 9]);
    b.loadFromArray(new Int32Array([1, 4, 9]));
    expect([...a.toSparse()]).toStrictEqual([...b.toSparse()]);
    expect(a.pivot()).toBe(b.pivot());
  });

  it("loadFromNumbers clears prior state (not additive)", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([1, 2, 3]);
    hc.loadFromNumbers([8]);
    expect([...hc.toSparse()]).toStrictEqual([8]);
  });

  it("clear() removes all entries", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([1, 2, 3]);
    hc.clear();
    expect(hc.pivot()).toBe(-1);
    expect([...hc.toSparse()]).toStrictEqual([]);
  });

  it("xorSparse toggles entries: symmetric difference semantics", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([1, 2, 3]);
    hc.xorSparse(new Int32Array([2, 3, 4]));
    expect([...hc.toSparse()]).toStrictEqual([1, 4]);
  });

  it("xorSparse with empty array is no-op", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([1, 2, 3]);
    hc.xorSparse(new Int32Array([]));
    expect([...hc.toSparse()]).toStrictEqual([1, 2, 3]);
  });

  it("self-cancellation: xorSparse with own snapshot empties the column", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([1, 2, 3]);
    const snap = hc.toSparse();
    hc.xorSparse(snap);
    expect([...hc.toSparse()]).toStrictEqual([]);
    expect(hc.pivot()).toBe(-1);
  });

  it("repeated xorSparse of the same operand toggles on/off", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([5]);
    const op = new Int32Array([5, 6]);
    hc.xorSparse(op);
    expect([...hc.toSparse()]).toStrictEqual([6]);
    hc.xorSparse(op);
    expect([...hc.toSparse()]).toStrictEqual([5]);
  });

  it("pivot uses (val, rank) ordering: higher val wins even if rank is lower", () => {
    const hc = new HeapColumn((idx: number) => idx * 10);
    hc.loadFromNumbers([3]);
    hc.xorSparse(new Int32Array([2]));
    expect(hc.pivot()).toBe(3);
  });

  it("pivot stays stable across repeated calls (does not pop)", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([3, 7, 2]);
    expect(hc.pivot()).toBe(7);
    expect(hc.pivot()).toBe(7);
    expect(hc.pivot()).toBe(7);
  });

  it("pivot returns -1 after the column is emptied via xorSparse", () => {
    const hc = new HeapColumn((idx: number) => idx);
    hc.loadFromNumbers([3, 7, 2]);
    hc.xorSparse(new Int32Array([2, 3, 7]));
    expect(hc.pivot()).toBe(-1);
  });
});

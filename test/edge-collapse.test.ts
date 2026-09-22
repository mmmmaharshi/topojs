import { describe, it, expect } from "vitest";

import { collapseDominatedEdges } from "../src/core/edge-collapse.ts";

describe("edge collapse preprocessing", () => {
  it("K3 with equal values collapses to a 2-edge tree", () => {
    // Every edge is dominated (link = {third vertex}, a cone); the first
    // processed trims, the other two have empty links and stay.
    const out = collapseDominatedEdges(3, [
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 2, val: 1 },
      { u: 1, v: 2, val: 1 },
    ]);
    expect(out).toStrictEqual([
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 2, val: 1 },
    ]);
  });

  it("path graph passes through unchanged", () => {
    const edges = [
      { u: 0, v: 1, val: 1 },
      { u: 1, v: 2, val: 2 },
    ];
    expect(collapseDominatedEdges(3, edges)).toStrictEqual(edges);
  });

  it("triangle with pendant edge trims exactly the dominated edge", () => {
    const out = collapseDominatedEdges(4, [
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 2, val: 1 },
      { u: 1, v: 2, val: 1 },
      { u: 2, v: 3, val: 5 },
    ]);
    expect(out).toStrictEqual([
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 2, val: 1 },
      { u: 2, v: 3, val: 5 },
    ]);
  });

  it("shifts a dominated edge forward past future arrivals", () => {
    // (1,3)@2 is dominated by 0 at t=2 with future common neighbor 5
    // (arrival 5), so it shifts to 5, where neither 0 nor 5 dominates it.
    // (3,5)@5 survives via mutually-nonadjacent commons {1,2,4}; the rest
    // trim. Found by a random-graph probe, verified by hand.
    const input = [
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 3, val: 1 },
      { u: 2, v: 3, val: 1 },
      { u: 3, v: 4, val: 1 },
      { u: 1, v: 3, val: 2 },
      { u: 1, v: 5, val: 3 },
      { u: 2, v: 4, val: 3 },
      { u: 2, v: 5, val: 3 },
      { u: 0, v: 4, val: 4 },
      { u: 4, v: 5, val: 4 },
      { u: 3, v: 5, val: 5 },
    ];
    expect(collapseDominatedEdges(6, input)).toStrictEqual([
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 3, val: 1 },
      { u: 2, v: 3, val: 1 },
      { u: 3, v: 4, val: 1 },
      { u: 1, v: 5, val: 3 },
      { u: 2, v: 5, val: 3 },
      { u: 1, v: 3, val: 5 },
      { u: 3, v: 5, val: 5 },
    ]);
  });

  it("returns tiny inputs and oversized n unchanged (same reference)", () => {
    const empty: { u: number; v: number; val: number }[] = [];
    expect(collapseDominatedEdges(0, empty)).toBe(empty);
    const two = [
      { u: 0, v: 1, val: 1 },
      { u: 1, v: 2, val: 2 },
    ];
    expect(collapseDominatedEdges(3, two)).toBe(two);
    const big = [
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 2, val: 1 },
      { u: 1, v: 2, val: 1 },
    ];
    expect(collapseDominatedEdges(3000, big)).toBe(big);
  });

  it("output stays sorted with non-decreased values on a dense graph", () => {
    const input = [
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 2, val: 2 },
      { u: 0, v: 3, val: 3 },
      { u: 1, v: 2, val: 1 },
      { u: 1, v: 3, val: 2 },
      { u: 2, v: 3, val: 1 },
    ];
    const out = collapseDominatedEdges(4, input);
    expect(out.length).toBeLessThan(input.length);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.val).toBeGreaterThanOrEqual(out[i - 1]!.val);
    }
    for (const o of out) {
      const orig = input.find((e) => e.u === o.u && e.v === o.v);
      expect(orig).toBeDefined();
      expect(o.val).toBeGreaterThanOrEqual(orig!.val);
    }
  });
});

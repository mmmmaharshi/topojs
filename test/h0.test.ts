import { describe, it, expect } from "vitest";
import { computeH0, computeH0Phase } from "../src/core/h0.ts";
import type { EdgeEntry } from "../src/core/h0.ts";

/**
 * computeH0Phase is the union-find + essential-emission primitive extracted
 * (during a codebase audit) out of 5 near-identical inline copies across
 * homology.ts, homology-fast.ts, homology-cohom.ts, cubical.ts, and
 * incremental-h1.ts. It had no direct tests of its own before this file --
 * only indirect coverage through those 5 call sites' own differential
 * tests against computePersistentHomology. This file tests it in
 * isolation, plus locks in the fix to computeH0 (a 6th, previously-unused
 * copy that had drifted: it never emitted essential/surviving-component
 * pairs, unlike every live copy -- now fixed by delegating to
 * computeH0Phase so it can't drift again).
 */
describe(computeH0Phase, () => {
  it("single point, no edges -> exactly one essential H0 class", () => {
    const { h0Pairs, cycleEdges } = computeH0Phase(1, []);
    expect(h0Pairs).toStrictEqual([{ birth: 0, death: -1, dim: 0 }]);
    expect(cycleEdges).toHaveLength(0);
  });

  it("two points, one connecting edge -> one finite + one essential pair", () => {
    const edges: EdgeEntry[] = [{ u: 0, v: 1, val: 0.5 }];
    const { h0Pairs, cycleEdges } = computeH0Phase(2, edges);
    expect(h0Pairs).toContainEqual({ birth: 0, death: 0.5, dim: 0 });
    expect(h0Pairs.filter((p) => p.death < 0)).toHaveLength(1);
    expect(Array.from(cycleEdges)).toStrictEqual([0]); // the merging edge is NOT a cycle edge
  });

  it("a triangle (3 points, 3 edges) -> 2 finite merges + 1 essential, 1 cycle edge", () => {
    // Edges processed in filtration order 0-1, 1-2, 0-2. The first two merge
    // everything into one component; the third (0-2) closes a cycle.
    const edges: EdgeEntry[] = [
      { u: 0, v: 1, val: 1 },
      { u: 1, v: 2, val: 2 },
      { u: 0, v: 2, val: 3 },
    ];
    const { h0Pairs, cycleEdges } = computeH0Phase(3, edges);
    const finite = h0Pairs.filter((p) => p.death >= 0);
    const essential = h0Pairs.filter((p) => p.death < 0);
    expect(finite).toHaveLength(2);
    expect(essential).toHaveLength(1);
    expect(Array.from(cycleEdges)).toStrictEqual([0, 0, 1]); // only the 3rd edge is a cycle edge
  });

  it("fully disconnected points (no edges) -> one essential class per point", () => {
    const { h0Pairs } = computeH0Phase(5, []);
    expect(h0Pairs).toHaveLength(5);
    expect(h0Pairs.every((p) => p.death === -1)).toBeTruthy();
  });

  it("two disjoint components -> two essential classes, correct finite count", () => {
    // Points 0,1,2 form one component; points 3,4 form another.
    const edges: EdgeEntry[] = [
      { u: 0, v: 1, val: 1 },
      { u: 1, v: 2, val: 2 },
      { u: 3, v: 4, val: 1.5 },
    ];
    const { h0Pairs } = computeH0Phase(5, edges);
    const finite = h0Pairs.filter((p) => p.death >= 0);
    const essential = h0Pairs.filter((p) => p.death < 0);
    expect(finite).toHaveLength(3); // all 3 edges merge (no cycles across 2 disjoint trees)
    expect(essential).toHaveLength(2); // one surviving component each
  });

  it("total pairs always equals n - (number of components) + (number of components) = n - components + components... i.e. finite = n - components, essential = components", () => {
    // General invariant check, several random-ish configurations.
    const cases: { n: number; edges: EdgeEntry[]; expectedComponents: number }[] = [
      {
        edges: [
          { u: 0, v: 1, val: 1 },
          { u: 2, v: 3, val: 1 },
        ],
        expectedComponents: 2,
        n: 4,
      },
      {
        edges: [
          { u: 0, v: 1, val: 1 },
          { u: 1, v: 2, val: 1 },
          { u: 3, v: 4, val: 1 },
        ],
        expectedComponents: 3,
        n: 6,
      }, // {0,1,2},{3,4},{5}
      { edges: [], expectedComponents: 3, n: 3 },
    ];
    for (const { n, edges, expectedComponents } of cases) {
      const { h0Pairs } = computeH0Phase(n, edges);
      const essential = h0Pairs.filter((p) => p.death < 0).length;
      const finite = h0Pairs.filter((p) => p.death >= 0).length;
      expect(essential, `n=${n}`).toBe(expectedComponents);
      expect(finite, `n=${n}`).toBe(n - expectedComponents);
    }
  });
});

describe("computeH0 (thin wrapper -- found and fixed a real drift bug)", () => {
  it("emits essential pairs (the bug: this used to never happen, unlike every live H0 implementation)", () => {
    // Before the fix, computeH0(1, []) returned [] -- silently under-
    // reporting the one essential component a single isolated point must
    // produce. This is the exact regression this test locks in.
    const pairs = computeH0(1, []);
    expect(pairs).toStrictEqual([{ birth: 0, death: -1, dim: 0 }]);
  });

  it("matches computeH0Phase().h0Pairs exactly (same underlying implementation)", () => {
    const edges: EdgeEntry[] = [
      { u: 0, v: 1, val: 1 },
      { u: 1, v: 2, val: 2 },
      { u: 0, v: 2, val: 3 },
    ];
    const viaWrapper = computeH0(3, edges);
    const viaPhase = computeH0Phase(3, edges).h0Pairs;
    expect(viaWrapper).toStrictEqual(viaPhase);
  });
});

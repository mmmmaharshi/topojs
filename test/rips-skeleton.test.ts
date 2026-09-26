import { describe, expect, it } from "vitest";

import {
  buildImplicitRipsComplex,
  countImplicitTriangles,
} from "../src/core/complex-implicit.ts";
import { buildRipsComplex } from "../src/core/complex.ts";
import { buildRipsSkeleton } from "../src/core/rips-skeleton.ts";

const points = new Float64Array([0, 0, 0, 1, 1, 0, 1, 1]);

function expectAdjacencyBitsMatch(
  left: Uint32Array[],
  right: Uint32Array[]
): void {
  expect(left).toHaveLength(right.length);
  for (let i = 0; i < left.length; i++) {
    expect(left[i]).toHaveLength(right[i]!.length);
    for (let j = 0; j < left[i]!.length; j++) {
      expect(left[i]![j]).toBe(right[i]![j]);
    }
  }
}

describe("private Rips skeleton seam", () => {
  it("feeds materialized and implicit adapters with collapse, lookup, and counts", () => {
    const skeleton = buildRipsSkeleton(points, 2, 2, { collapseMaxDim: 2 });
    const materialized = buildRipsComplex(points, 2, 2, 2);
    const implicit = buildImplicitRipsComplex(points, 2, 2);

    const expectedEdges = [
      { u: 0, v: 1, val: 1 },
      { u: 0, v: 2, val: 1 },
      { u: 1, v: 3, val: 1 },
      { u: 2, v: 3, val: 1 },
      { u: 0, v: 3, val: Math.SQRT2 },
    ];
    expect([skeleton.edges, materialized.edges, implicit.edges]).toStrictEqual([
      expectedEdges,
      expectedEdges,
      expectedEdges,
    ]);
    expectAdjacencyBitsMatch(skeleton.adjBits, materialized.adjBits!);
    expectAdjacencyBitsMatch(skeleton.adjBits, implicit.adjBits);
    expect([
      skeleton.edgeValue(1, 3),
      implicit.triangleValueByRank(1),
      countImplicitTriangles(implicit),
    ]).toStrictEqual([1, Math.SQRT2, materialized.triangles.length]);
  });

  it("keeps the Sheehy active subset and applies collapse to both adapters", () => {
    const skeleton = buildRipsSkeleton(points, 2, 2, {
      collapseMaxDim: 2,
      epsilon: 0.5,
    });
    const materialized = buildRipsComplex(points, 2, 2, 2, 0.5);
    const implicit = buildImplicitRipsComplex(points, 2, 2, 0.5);

    const expectedEdges = [
      { u: 0, v: 1, val: 1 },
      { u: 1, v: 3, val: 1 },
    ];
    expect([skeleton.edges, materialized.edges, implicit.edges]).toStrictEqual([
      expectedEdges,
      expectedEdges,
      expectedEdges,
    ]);
    expectAdjacencyBitsMatch(skeleton.adjBits, materialized.adjBits!);
    expectAdjacencyBitsMatch(skeleton.adjBits, implicit.adjBits);
    expect(countImplicitTriangles(implicit)).toBe(
      materialized.triangles.length
    );
  });
});

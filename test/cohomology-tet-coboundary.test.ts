import { describe, expect, it } from "vitest";

import { buildFlippedTetrahedronCoboundary } from "../src/core/cohomology-tet-coboundary.ts";
import type { TetraEntry } from "../src/core/complex.ts";

const tetrahedra: TetraEntry[] = [
  { triangles: [0, 1, 2, 3], val: 4 },
  { triangles: [1, 2, 3, 4], val: 5 },
];

describe(buildFlippedTetrahedronCoboundary, () => {
  it("groups flipped tetrahedron columns by triangle", () => {
    const result = buildFlippedTetrahedronCoboundary(6, tetrahedra);

    expect(result.start).toStrictEqual(Int32Array.from([0, 1, 3, 5, 7, 8, 8]));
    expect(result.columns).toStrictEqual(
      Int32Array.from([1, 1, 0, 1, 0, 1, 0, 0])
    );
  });
});

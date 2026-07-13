import { describe, it, expect } from "vitest";
import { computePersistentHomologyGeneral } from "../src/core/homology-general.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { mulberry32 } from "./helpers.ts";
import type { Points } from "../src/core/distance.ts";
import type { PersistencePair } from "../src/core/h0.ts";

function randomPoints(rng: () => number, n: number, dims: number): Points {
  const pts = new Float64Array(n * dims);
  for (let i = 0; i < pts.length; i++) {
    pts[i] = rng();
  }
  return pts;
}

function sortedKey(p: PersistencePair): string {
  return `${p.dim}|${p.birth.toFixed(9)}|${p.death < 0 ? "inf" : p.death.toFixed(9)}`;
}

function sortedKeys(pairs: PersistencePair[]): string[] {
  return pairs.map(sortedKey).toSorted();
}

describe("computePersistentHomologyGeneral: differential test against computePersistentHomology (maxHomologyDim<=2)", () => {
  it("matches exactly across many random 2D/3D configs at maxHomologyDim=1", () => {
    const rng = mulberry32(1);
    for (let trial = 0; trial < 200; trial++) {
      const n = 5 + Math.floor(rng() * 20);
      const dims = rng() < 0.5 ? 2 : 3;
      const maxDist = 0.2 + rng() * 0.8;
      const pts = randomPoints(rng, n, dims);

      const exact = computePersistentHomology(pts, dims, maxDist, 2);
      const general = computePersistentHomologyGeneral(pts, dims, maxDist, 1);

      // exact computes H0+H1+H2 always when maxDim=2 is passed (see
      // homology.ts: maxDim 1 and 2 are equivalent, both H0+H1 only) --
      // restrict exact's output to dim<=1 to match general's maxHomologyDim=1 scope.
      const exactRestricted = exact.pairs.filter((p) => p.dim <= 1);
      expect(sortedKeys(general.pairs)).toStrictEqual(sortedKeys(exactRestricted));
    }
  });

  it("matches exactly across many random configs at maxHomologyDim=2 (needs tetrahedra)", () => {
    const rng = mulberry32(2);
    for (let trial = 0; trial < 100; trial++) {
      const n = 5 + Math.floor(rng() * 15);
      const dims = rng() < 0.5 ? 2 : 3;
      const maxDist = 0.3 + rng() * 0.9;
      const pts = randomPoints(rng, n, dims);

      const exact = computePersistentHomology(pts, dims, maxDist, 3);
      const general = computePersistentHomologyGeneral(pts, dims, maxDist, 2);

      expect(sortedKeys(general.pairs)).toStrictEqual(sortedKeys(exact.pairs));
    }
  });

  it("matches on the known 12-gon single-H1-loop configuration", () => {
    const n = 12;
    const pts = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      pts[i * 2] = Math.cos(a);
      pts[i * 2 + 1] = Math.sin(a);
    }
    const chord = 2 * Math.sin(Math.PI / 12);
    const general = computePersistentHomologyGeneral(pts, 2, chord + 0.05, 1);
    expect(general.simplexCounts[0]).toBe(12);
    expect(general.simplexCounts[1]).toBe(12);
    expect(general.pairs.filter((p) => p.dim === 1 && p.death < 0)).toHaveLength(1);
  });
});

describe("computePersistentHomologyGeneral: H3 ground truth (16-cell boundary = S^3)", () => {
  // The 4D analog of the octahedron/S^2 test already in test/rips.test.ts:
  // 8 vertices at (+-1,0,0,0),(0,+-1,0,0),(0,0,+-1,0),(0,0,0,+-1) in R^4
  // (the 4D cross-polytope / "16-cell"). Antipodal pairs are at distance 2;
  // every other pair is at distance sqrt(2). At maxDist in [sqrt(2), 2),
  // no antipodal pair is connected -- and since there are only 4 antipodal
  // pairs among 8 vertices, any 5 chosen vertices must include a full pair
  // (pigeonhole: at most 1 per pair from 4 pairs = 4 vertices), so NO
  // 4-simplex (5-clique) can form geometrically, regardless of how high
  // maxSimplexDim is set -- exactly analogous to the octahedron's "0
  // tetrahedra since every 4-point subset includes an antipodal pair".
  // The resulting complex is the boundary of the 16-cell, a known
  // triangulation of S^3: f-vector (8, 24, 32, 16), Betti (1, 0, 0, 1).
  function crossPolytope4D(): Points {
    return new Float64Array([
      1, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0,
      0, -1,
    ]);
  }

  it("has simplex counts matching the known 16-cell f-vector (8, 24, 32, 16), and 0 four-simplices (confirms the pigeonhole argument: no 5-clique can form)", () => {
    const pts = crossPolytope4D();
    const eps = Math.SQRT2 + 0.01;
    // maxHomologyDim=3 builds up to dimension 4 (maxHomologyDim+1, needed to
    // determine what -- if anything -- kills the H3 class); the trailing 0
    // is that dimension-4 (5-vertex) simplex count, and IS the point of
    // this test: it confirms geometrically, not just by the Betti-number
    // test below, that nothing was available to fill the S^3 void.
    const res = computePersistentHomologyGeneral(pts, 4, eps, 3);
    expect(res.simplexCounts).toStrictEqual([8, 24, 32, 16, 0]);
  });

  it("has a single essential H3 class, no essential H1/H2", () => {
    const pts = crossPolytope4D();
    const eps = Math.SQRT2 + 0.01;
    const res = computePersistentHomologyGeneral(pts, 4, eps, 3);

    expect(res.pairs.filter((p) => p.dim === 0 && p.death < 0)).toHaveLength(1); // b0 = 1
    expect(res.pairs.filter((p) => p.dim === 1 && p.death < 0)).toHaveLength(0); // b1 = 0
    expect(res.pairs.filter((p) => p.dim === 2 && p.death < 0)).toHaveLength(0); // b2 = 0
    expect(res.pairs.filter((p) => p.dim === 3 && p.death < 0)).toHaveLength(1); // b3 = 1
  });

  it("Euler-Poincare cross-check: chi = V-E+T-Tet = b0-b1+b2-b3 = 0 (matches chi(S^3)=0)", () => {
    const pts = crossPolytope4D();
    const eps = Math.SQRT2 + 0.01;
    const res = computePersistentHomologyGeneral(pts, 4, eps, 3);
    const [V, E, T, Tet] = res.simplexCounts;
    const chiSimplicial = V! - E! + T! - Tet!;
    const b0 = res.pairs.filter((p) => p.dim === 0 && p.death < 0).length;
    const b1 = res.pairs.filter((p) => p.dim === 1 && p.death < 0).length;
    const b2 = res.pairs.filter((p) => p.dim === 2 && p.death < 0).length;
    const b3 = res.pairs.filter((p) => p.dim === 3 && p.death < 0).length;
    const chiBetti = b0 - b1 + b2 - b3;
    expect(chiSimplicial).toBe(0); // chi(S^3) = 0
    expect(chiBetti).toBe(chiSimplicial);
  });

  it("at a larger maxDist, tetrahedra fill in and the H3 void closes", () => {
    // Once maxDist >= 2, antipodal pairs connect too -> the full 8-point
    // complex becomes a cone-like configuration with no S^3 void.
    const pts = crossPolytope4D();
    const res = computePersistentHomologyGeneral(pts, 4, 2.1, 3);
    expect(res.pairs.filter((p) => p.dim === 3 && p.death < 0)).toHaveLength(0);
  });
});

describe("computePersistentHomologyGeneral: edge cases", () => {
  it("maxHomologyDim=0 computes H0 only, matching computeH0Phase-derived exact H0", () => {
    const rng = mulberry32(3);
    const n = 15;
    const pts = randomPoints(rng, n, 2);
    const maxDist = 0.4;
    const general = computePersistentHomologyGeneral(pts, 2, maxDist, 0);
    const exact = computePersistentHomology(pts, 2, maxDist, 0);
    expect(sortedKeys(general.pairs)).toStrictEqual(
      sortedKeys(exact.pairs.filter((p) => p.dim === 0)),
    );
  });

  it("throws on negative maxHomologyDim", () => {
    const pts = new Float64Array([0, 0, 1, 0]);
    expect(() => computePersistentHomologyGeneral(pts, 2, 1, -1)).toThrow(RangeError);
  });

  it("single point: H0 essential only, no higher dims", () => {
    const pts = new Float64Array([0, 0]);
    const res = computePersistentHomologyGeneral(pts, 2, 1, 3);
    expect(res.pairs).toStrictEqual([{ birth: 0, death: -1, dim: 0 }]);
  });

  it("empty point cloud does not throw", () => {
    const res = computePersistentHomologyGeneral(new Float64Array(0), 2, 1, 2);
    expect(res.pairs).toStrictEqual([]);
  });

  it("disjoint components each contribute their own H0 essential pair, no higher-dim cross-talk", () => {
    const a = new Float64Array([0, 0, 1, 0, 0.5, 0.866]); // triangle
    const b = new Float64Array([100, 100, 101, 100, 100.5, 100.866]); // far triangle
    const combined = new Float64Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    const res = computePersistentHomologyGeneral(combined, 2, 1.5, 2);
    expect(res.pairs.filter((p) => p.dim === 0 && p.death < 0)).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import { computePersistentHomology } from "../src/core/homology.ts";
import { generatePoints, circlePoints, mulberry32, countByDim, eulerCheck } from "./helpers.ts";

describe("rips: known geometric ground truths", () => {
  it("two separate points -> 2 components", () => {
    const pts = generatePoints([
      [0, 0],
      [3, 0],
    ]);
    const res = computePersistentHomology(pts, 2, 5);
    expect(res.complex.numVertices).toBe(2);
    expect(countByDim(res.pairs, 0)).toBe(2);
    expect(res.pairs.filter((p) => p.dim === 0 && p.death >= 0)).toHaveLength(1);
    expect(res.pairs.filter((p) => p.dim === 0 && p.death < 0)).toHaveLength(1);
  });

  it("three collinear points -> chain merges, no H1", () => {
    const pts = generatePoints([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const res = computePersistentHomology(pts, 2, 5);
    expect(countByDim(res.pairs, 0)).toBe(3);
    expect(res.complex.numTriangles).toBeGreaterThanOrEqual(1);
    const significantH1 = res.pairs.filter((p) => p.dim === 1 && p.death - p.birth > 1e-10);
    expect(significantH1).toHaveLength(0);
  });

  it("12-gon at chord threshold -> single essential H1 loop", () => {
    const pts = circlePoints(12, 1);
    const chord = 2 * Math.sin(Math.PI / 12);
    const res = computePersistentHomology(pts, 2, chord + 0.05);
    expect(res.complex.numVertices).toBe(12);
    expect(res.complex.numEdges).toBe(12);
    expect(res.complex.numTriangles).toBe(0);
    expect(countByDim(res.pairs, 0)).toBe(12);
    expect(res.pairs.filter((p) => p.dim === 1 && p.death < 0)).toHaveLength(1);
  });

  it("12-gon at larger threshold -> H1 cycle dies at predicted birth", () => {
    const pts = circlePoints(12, 1);
    const chord = 2 * Math.sin(Math.PI / 12);
    const nextChord = 2 * Math.sin((2 * Math.PI) / 12);
    const res = computePersistentHomology(pts, 2, nextChord + 0.05);
    expect(res.complex.numTriangles).toBeGreaterThan(0);
    const significant = res.pairs.filter(
      (p) => p.dim === 1 && (p.death < 0 || p.death - p.birth > 0.1),
    );
    expect(significant).toHaveLength(1);
    const sigH1 = significant[0]!;
    expect(sigH1.birth).toBeCloseTo(chord, 2);
    expect(sigH1.death).toBeLessThan(0);
  });

  it("octahedron (6 pts on S^2) -> single essential H2 class", () => {
    const pts = new Float64Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);
    const eps = Math.SQRT2;
    const res = computePersistentHomology(pts, 3, eps + 0.01, 3);
    expect(res.complex.numVertices).toBe(6);
    expect(res.complex.numEdges).toBe(12);
    expect(res.complex.numTriangles).toBe(8);
    expect(res.complex.numTetrahedra).toBe(0);
    expect(res.pairs.filter((p) => p.dim === 2)).toHaveLength(1);
  });

  it("octahedron + Euler-Poincare cross-check (chi = V-E+T = b0-b1+b2)", () => {
    // Tet === 0 here, so b3 cannot be nonzero — safe to compare the full
    // simplicial Euler characteristic against b0-b1+b2.
    const pts = new Float64Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);
    const eps = Math.SQRT2;
    const res = computePersistentHomology(pts, 3, eps + 0.01, 3);
    expect(res.complex.numTetrahedra).toBe(0);
    const { chiSimplicial, chiBetti, b0, b1, b2 } = eulerCheck(res);
    expect(chiSimplicial).toBe(chiBetti);
    expect([b0, b1, b2]).toStrictEqual([1, 0, 1]);
  });

  it("octahedron tetrahedra kill the H2 cycle", () => {
    const pts = new Float64Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);
    const res = computePersistentHomology(pts, 3, 2.1, 3);
    expect(res.complex.numTetrahedra).toBeGreaterThan(0);
    expect(res.pairs.filter((p) => p.dim === 2 && p.death < 0)).toHaveLength(0);
    expect(res.pairs.filter((p) => p.dim === 2 && p.death >= 0).length).toBeGreaterThan(0);
    // NOTE: at this threshold all 6 points form a 6-clique. The 3-skeleton of
    // a 5-simplex has real H3 of rank 5 (wedge of 5 copies of S^3) which this
    // library does not compute (H0-H2 only, per README). Euler-Poincare is
    // therefore deliberately NOT asserted for this config — chi_simplicial
    // would legitimately disagree with b0-b1+b2 by exactly -b3 = -5. This is
    // a documented scope limitation, not a bug.
  });

  it("large-radius octahedron leaves H2 partially essential (smoke)", () => {
    const scale = 2;
    const pts = new Float64Array([
      scale,
      0,
      0,
      -scale,
      0,
      0,
      0,
      scale,
      0,
      0,
      -scale,
      0,
      0,
      0,
      scale,
      0,
      0,
      -scale,
    ]);
    const eps = scale * Math.SQRT2 + 0.5;
    const res = computePersistentHomology(pts, 3, eps, 3);
    expect(res.pairs.length).toBeGreaterThan(0);
  });

  it("disjoint union of two 12-gons -> beta0=2, beta1=2 (no cross-talk)", () => {
    // Reuses the exact 12-gon construction from the single-loop test above,
    // translated far away, to confirm the algorithm keeps independent
    // components and their cycles separate rather than accidentally merging
    // topology across components.
    const nextChord = 2 * Math.sin((2 * Math.PI) / 12);
    const maxDist = nextChord + 0.05;
    const a = circlePoints(12, 1, 0, 0);
    const b = circlePoints(12, 1, 1000, 0); // translated far beyond maxDist
    const combined = new Float64Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    const res = computePersistentHomology(combined, 2, maxDist, 2);
    expect(res.complex.numVertices).toBe(24);
    expect(res.pairs.filter((p) => p.dim === 0 && p.death < 0)).toHaveLength(2);
    const significantH1 = res.pairs.filter(
      (p) => p.dim === 1 && (p.death < 0 || p.death - p.birth > 0.1),
    );
    expect(significantH1).toHaveLength(2);
  });
});

describe("rips: property-based Euler-Poincare (randomized)", () => {
  it("holds for 20 seeded randomized 4-point clouds", () => {
    // With n=4 points, at most 1 tetrahedron can ever form, whose own
    // boundary (4 triangles) is never zero — so an essential H3 class is
    // combinatorially impossible. b3=0 is therefore guaranteed exact, and
    // comparing the full simplicial Euler characteristic to b0-b1+b2 is a
    // sound invariant check (not just a coincidence of a hand-picked shape).
    const rng = mulberry32(20_260_710);
    const TRIALS = 20;
    for (let t = 0; t < TRIALS; t++) {
      const pts = new Float64Array(8);
      for (let i = 0; i < 8; i++) {
        pts[i] = rng() * 10 - 5;
      }
      const res = computePersistentHomology(pts, 2, Infinity, 3);
      const { chiSimplicial, chiBetti } = eulerCheck(res);
      expect(chiSimplicial, `trial ${t}`).toBe(chiBetti);
    }
  });
});

describe("rips: edge cases & numerical robustness", () => {
  it("empty point cloud does not crash", () => {
    const pts = new Float64Array(0);
    const res = computePersistentHomology(pts, 2, 5);
    expect(res.complex.numVertices).toBe(0);
    expect(res.pairs).toHaveLength(0);
  });

  it("single point produces one essential H0 class, nothing else", () => {
    const pts = new Float64Array([0, 0]);
    const res = computePersistentHomology(pts, 2, 5);
    expect(res.complex.numVertices).toBe(1);
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]!.dim).toBe(0);
    expect(res.pairs[0]!.death).toBeLessThan(0);
  });

  it("coincident (zero-distance) points merge at birth=death=0", () => {
    const pts = generatePoints([
      [0, 0],
      [0, 0],
      [5, 0],
    ]);
    const res = computePersistentHomology(pts, 2, 10);
    expect(res.pairs.filter((p) => p.dim === 0 && p.death === 0)).toHaveLength(1);
  });

  it("maxDist=0 only merges exactly-coincident points", () => {
    const pts = generatePoints([
      [0, 0],
      [0, 0],
      [5, 0],
    ]);
    const res = computePersistentHomology(pts, 2, 0);
    expect(res.complex.numEdges).toBe(1);
    expect(res.pairs.filter((p) => p.dim === 0 && p.death < 0)).toHaveLength(2);
  });

  it("default parameters (maxDist=Infinity, maxDim=2) do not throw", () => {
    const pts = generatePoints([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
    const res = computePersistentHomology(pts, 2);
    expect(res.complex.numVertices).toBe(3);
  });

  it("same input run twice yields identical pairs (determinism)", () => {
    const rng = mulberry32(7);
    const n = 25;
    const pts = new Float64Array(n * 2);
    for (let i = 0; i < n * 2; i++) {
      pts[i] = rng();
    }
    const r1 = computePersistentHomology(pts, 2, 0.6, 2);
    const r2 = computePersistentHomology(pts, 2, 0.6, 2);
    expect(r1.pairs).toStrictEqual(r2.pairs);
  });

  it("seeded random cloud smoke test (30 pts)", () => {
    const rng = mulberry32(42);
    const n = 30;
    const flat = new Float64Array(n * 2);
    for (let i = 0; i < n * 2; i++) {
      flat[i] = rng();
    }
    const res = computePersistentHomology(flat, 2, 2);
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(res.complex.numVertices).toBe(n);
  });
});

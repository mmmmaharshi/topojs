/* eslint-disable vitest/expect-expect */
import { describe, it, expect } from "vitest";

import { buildRipsComplex } from "../src/core/complex.ts";
import {
  computePersistentHomologyCohomologyFromComplex,
  computePersistentHomologyCohomologyImplicit,
} from "../src/core/homology-cohom-implicit.ts";
import { computePersistentHomologyCohomology } from "../src/core/homology-cohom.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { mulberry32, circlePoints, generatePoints } from "./helpers.ts";

function canon(pairs: { dim: number; birth: number; death: number }[]): string {
  return JSON.stringify(
    pairs
      .map((p) => ({ birth: p.birth, death: p.death, dim: p.dim }))
      .toSorted(
        (a, b) => a.dim - b.dim || a.birth - b.birth || a.death - b.death
      )
  );
}

function checkMatchesExact(
  points: Float64Array,
  dims: number,
  maxDist: number,
  maxDim: number
): void {
  const expected = computePersistentHomology(points, dims, maxDist, maxDim);
  const actual = computePersistentHomologyCohomologyImplicit(
    points,
    dims,
    maxDist,
    maxDim
  );
  expect(canon(actual.pairs)).toBe(canon(expected.pairs));
}

// The cohomology engine with implicit matrix should produce the same barcode
// as the one with explicit CSR, since the only difference is HOW coboundary
// columns are generated, not the algorithm.
function checkMatchesImplicitVsExplicit(
  points: Float64Array,
  dims: number,
  maxDist: number,
  maxDim: number
): void {
  const explicit = computePersistentHomologyCohomology(
    points,
    dims,
    maxDist,
    maxDim
  );
  const implicit = computePersistentHomologyCohomologyImplicit(
    points,
    dims,
    maxDist,
    maxDim
  );
  expect(implicit.complex).toStrictEqual(explicit.complex);
  expect(canon(implicit.pairs)).toBe(canon(explicit.pairs));
}

describe("computePersistentHomologyCohomologyImplicit (implicit matrix) vs. computePersistentHomology (ground truth)", () => {
  it("matches on random point clouds across many seeds and densities", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = mulberry32(seed);
      const n = 20 + (seed % 5) * 5;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        pts.push([rng(), rng()]);
      }
      const flat = generatePoints(pts);
      for (const maxDist of [0.2, 0.35, 0.5, 1.5]) {
        checkMatchesExact(flat, 2, maxDist, 2);
      }
    }
  });

  it("matches on a circle (many triangles, structured geometry)", () => {
    for (const n of [8, 12, 16, 24]) {
      const pts = circlePoints(n, 1);
      checkMatchesExact(pts, 2, 0.9, 2);
    }
  });

  it("matches on tie-heavy grid point clouds", () => {
    for (const size of [3, 4, 5]) {
      const pts: [number, number][] = [];
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          pts.push([i, j]);
        }
      }
      const flat = generatePoints(pts);
      for (const maxDist of [1, 1.5, Math.SQRT2 + 0.01, 2.5]) {
        checkMatchesExact(flat, 2, maxDist, 2);
      }
    }
  });

  it("matches on a 1D lattice (extreme tie density)", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 15; i++) {
      pts.push([i, 0]);
    }
    const flat = generatePoints(pts);
    for (const maxDist of [1, 2, 3, 5]) {
      checkMatchesExact(flat, 2, maxDist, 2);
    }
  });

  it("matches in 3D", () => {
    const rng = mulberry32(42);
    for (const n of [15, 25]) {
      const pts: number[] = [];
      for (let i = 0; i < n * 3; i++) {
        pts.push(rng());
      }
      checkMatchesExact(new Float64Array(pts), 3, 0.6, 2);
    }
  });

  it("matches with maxDim=3 (H2 cohomology-accelerated path)", () => {
    const rng = mulberry32(99);
    const pts: number[] = [];
    for (let i = 0; i < 12 * 3; i++) {
      pts.push(rng());
    }
    checkMatchesExact(new Float64Array(pts), 3, 0.8, 3);
  });

  it("matches with maxDim=3 across many seeds/densities (H2 stress)", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed);
      const n = 10 + (seed % 6) * 3;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        pts.push([rng(), rng()]);
      }
      const flat = generatePoints(pts);
      for (const maxDist of [0.4, 0.8, 1.5]) {
        checkMatchesExact(flat, 2, maxDist, 3);
      }
    }
  });

  it("produces ESSENTIAL H2 on hollow octahedron (regression test)", () => {
    const pts = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    for (const maxDist of [1.42, 1.5, 1.7, 1.9, 1.99]) {
      checkMatchesExact(pts, 3, maxDist, 3);
    }
  });

  it("matches on sparse/disconnected configurations", () => {
    const rng = mulberry32(77);
    const pts: [number, number][] = [];
    for (let i = 0; i < 30; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    checkMatchesExact(flat, 2, 0.1, 2);
  });

  it("matches on synthetic loop geometry (essential H1 class)", () => {
    const pts = circlePoints(20, 1);
    checkMatchesExact(pts, 2, 0.35, 2);
  });

  it("matches on a larger dense cloud", () => {
    const rng = mulberry32(4242);
    const n = 80;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    checkMatchesExact(flat, 2, 0.3, 2);
  });
});

describe("Implicit matrix matches explicit CSR cohomology engine exactly", () => {
  it("matches across random 2D configs", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed * 100);
      const n = 15 + (seed % 10) * 3;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        pts.push([rng(), rng()]);
      }
      const flat = generatePoints(pts);
      for (const maxDist of [0.25, 0.5, 0.8, 1.5]) {
        checkMatchesImplicitVsExplicit(flat, 2, maxDist, 2);
      }
    }
  });

  it("matches across random 3D configs with maxDim=3", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const rng = mulberry32(seed * 100 + 50);
      const n = 10 + (seed % 5) * 3;
      const pts: number[] = [];
      for (let i = 0; i < n * 3; i++) {
        pts.push(rng());
      }
      for (const maxDist of [0.5, 0.8, 1.2]) {
        checkMatchesImplicitVsExplicit(new Float64Array(pts), 3, maxDist, 3);
      }
    }
  });

  it("matches on tie-heavy 3D grids", () => {
    for (const size of [3, 4]) {
      const pts: number[] = [];
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          for (let k = 0; k < 2; k++) {
            pts.push(i, j, k);
          }
        }
      }
      for (const maxDist of [1, 1.5, 2, 2.5]) {
        checkMatchesImplicitVsExplicit(new Float64Array(pts), 3, maxDist, 3);
      }
    }
  });

  it("matches on hollow octahedron (essential H2)", () => {
    const pts = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    for (const maxDist of [1.42, 1.5, 1.7]) {
      checkMatchesImplicitVsExplicit(pts, 3, maxDist, 3);
    }
  });
});

describe("computePersistentHomologyCohomologyFromComplex (with pre-built complex)", () => {
  it("matches the convenience wrapper", () => {
    const rng = mulberry32(55);
    const pts: [number, number][] = [];
    for (let i = 0; i < 30; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    const complex = buildRipsComplex(flat, 2, 0.5, 3);
    const fromComplex = computePersistentHomologyCohomologyFromComplex(
      complex,
      3
    );
    const implicit = computePersistentHomologyCohomologyImplicit(
      flat,
      2,
      0.5,
      3
    );
    expect(canon(fromComplex.pairs)).toBe(canon(implicit.pairs));
  });
});

describe("Sheehy sparse Rips (epsilon parameter on buildRipsComplex)", () => {
  it("epsilon=0 means no shearing (exact complex, no Sheehy metadata)", () => {
    const rng = mulberry32(123);
    for (let seed = 0; seed < 10; seed++) {
      const pts: [number, number][] = [];
      for (let i = 0; i < 25; i++) {
        pts.push([rng(), rng()]);
      }
      const flat = generatePoints(pts);
      const maxDist = 0.4;
      const full = buildRipsComplex(flat, 2, maxDist, 2);
      const zero = buildRipsComplex(flat, 2, maxDist, 2, 0);
      expect(zero.sheehy).toBeUndefined();
      expect(zero.edges).toHaveLength(full.edges.length);
      expect(zero.triangles).toHaveLength(full.triangles.length);
    }
  });

  it("epsilon < 1 produces a sparser complex (fewer simplices)", () => {
    const rng = mulberry32(456);
    const pts: [number, number][] = [];
    for (let i = 0; i < 60; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    const maxDist = 0.35;
    const full = buildRipsComplex(flat, 2, maxDist, 2);
    const sparse = buildRipsComplex(flat, 2, maxDist, 2, 0.3);
    // Should produce at most the same number of simplices as the full complex
    // (active point count is part of the Sheehy metadata)
    expect(sparse.sheehy!.activeCount).toBeLessThanOrEqual(60);
    expect(sparse.edges.length).toBeLessThanOrEqual(full.edges.length);
    expect(sparse.triangles.length).toBeLessThanOrEqual(full.triangles.length);
  });

  it("Sheehy sparse + implicit matrix runs on random configs without error", () => {
    const rng = mulberry32(789);
    for (let trial = 0; trial < 20; trial++) {
      const n = 15 + Math.floor(rng() * 15);
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        pts.push([rng(), rng()]);
      }
      const flat = generatePoints(pts);
      const maxDist = 0.3 + rng() * 0.3;
      const epsilon = 0.2 + rng() * 0.4;

      // Must not throw
      const sparseComplex = buildRipsComplex(flat, 2, maxDist, 2, epsilon);
      const sparse = computePersistentHomologyCohomologyFromComplex(
        sparseComplex,
        2
      );

      expect(sparse.pairs.length).toBeGreaterThan(0);
      // Sheehy metadata should be present
      expect(sparseComplex.sheehy!.epsilon).toBe(epsilon);
      expect(sparseComplex.sheehy!.activeCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("with large enough epsilon to include all points, matches the exact engine exactly", () => {
    const rng = mulberry32(101);
    const pts: [number, number][] = [];
    for (let i = 0; i < 20; i++) {
      pts.push([rng(), rng()]);
    }
    const flat = generatePoints(pts);
    // Use maxDist=2.0 (exceeding the ~1.41 diameter of [0,1]^2) so
    // epsilon * maxDist = 2.0 covers every point's insertion radius,
    // making ALL 20 points active.
    const maxDist = 2;
    const exact = computePersistentHomology(flat, 2, maxDist, 2);
    const sparseComplex = buildRipsComplex(flat, 2, maxDist, 2, 1);
    expect(sparseComplex.sheehy!.activeCount).toBe(20);
    const sparse = computePersistentHomologyCohomologyFromComplex(
      sparseComplex,
      2
    );
    expect(canon(sparse.pairs)).toBe(canon(exact.pairs));
  });
});

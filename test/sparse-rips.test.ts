import { readFileSync } from "node:fs";
import path from "node:path";

/* eslint-disable vitest/no-conditional-expect */
import { describe, it, expect } from "vitest";

import { bottleneckDistance } from "../src/core/bottleneck.ts";
import type { Points } from "../src/core/distance.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { selectLandmarks } from "../src/core/landmarks.ts";
import { computeSparseRipsHomology } from "../src/core/sparse-rips.ts";
import { mulberry32 } from "./helpers.ts";

function randomPoints(
  rng: () => number,
  n: number,
  dims: number,
  scale = 1
): Points {
  const pts = new Float64Array(n * dims);
  for (let i = 0; i < pts.length; i++) {
    pts[i] = rng() * scale;
  }
  return pts;
}

// Independent, deliberately-not-shared-code brute-force reference for the
// covering radius, so a bug in selectLandmarks' incremental bookkeeping
// can't also be baked into the check.
function bruteForceCoveringRadius(
  points: Points,
  dims: number,
  n: number,
  landmarkIndices: Int32Array
): number {
  let maxMin = 0;
  for (let i = 0; i < n; i++) {
    let minD = Infinity;
    for (const l of landmarkIndices) {
      let sq = 0;
      for (let d = 0; d < dims; d++) {
        const diff = points[i * dims + d]! - points[l * dims + d]!;
        sq += diff * diff;
      }
      const dist = Math.sqrt(sq);
      if (dist < minD) {
        minD = dist;
      }
    }
    if (minD > maxMin) {
      maxMin = minD;
    }
  }
  return maxMin;
}

describe(selectLandmarks, () => {
  it("first landmark is always startIndex", () => {
    const rng = mulberry32(1);
    const pts = randomPoints(rng, 30, 2);
    const { landmarkIndices } = selectLandmarks(pts, 2, 30, 10, 7);
    expect(landmarkIndices[0]).toBe(7);
  });

  it("returns exactly numLandmarks distinct indices, all in range", () => {
    const rng = mulberry32(2);
    const pts = randomPoints(rng, 40, 3);
    const { landmarkIndices } = selectLandmarks(pts, 3, 40, 12);
    expect(landmarkIndices).toHaveLength(12);
    const seen = new Set(landmarkIndices);
    expect(seen.size).toBe(12);
    for (const idx of landmarkIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(40);
    }
  });

  it("coveringRadius matches an independent brute-force computation", () => {
    const rng = mulberry32(3);
    for (let trial = 0; trial < 40; trial++) {
      const n = 10 + Math.floor(rng() * 40);
      const dims = 2 + Math.floor(rng() * 3);
      const numLandmarks = 2 + Math.floor(rng() * (n - 1));
      const pts = randomPoints(rng, n, dims);
      const { landmarkIndices, coveringRadius } = selectLandmarks(
        pts,
        dims,
        n,
        numLandmarks
      );
      const brute = bruteForceCoveringRadius(pts, dims, n, landmarkIndices);
      expect(coveringRadius).toBeCloseTo(brute, 9);
    }
  });

  it("insertionRadii is non-increasing from index 1 onward (standard farthest-point-sampling property)", () => {
    const rng = mulberry32(4);
    const pts = randomPoints(rng, 50, 2);
    const { insertionRadii } = selectLandmarks(pts, 2, 50, 20);
    expect(insertionRadii[0]).toBe(Infinity);
    for (let i = 2; i < insertionRadii.length; i++) {
      expect(insertionRadii[i]!).toBeLessThanOrEqual(
        insertionRadii[i - 1]! + 1e-12
      );
    }
  });

  it("numLandmarks >= n clamps to n landmarks with coveringRadius exactly 0", () => {
    const rng = mulberry32(5);
    const pts = randomPoints(rng, 15, 2);
    const { landmarkIndices, coveringRadius } = selectLandmarks(
      pts,
      2,
      15,
      100
    );
    expect(landmarkIndices).toHaveLength(15);
    expect(coveringRadius).toBe(0);
  });

  it("numLandmarks = 1 selects exactly startIndex", () => {
    const rng = mulberry32(6);
    const pts = randomPoints(rng, 20, 2);
    const { landmarkIndices } = selectLandmarks(pts, 2, 20, 1, 3);
    expect([...landmarkIndices]).toStrictEqual([3]);
  });

  it("throws on out-of-range startIndex", () => {
    const rng = mulberry32(7);
    const pts = randomPoints(rng, 10, 2);
    expect(() => selectLandmarks(pts, 2, 10, 5, -1)).toThrow(RangeError);
    expect(() => selectLandmarks(pts, 2, 10, 5, 10)).toThrow(RangeError);
  });

  it("n = 0 returns an empty result without throwing", () => {
    const result = selectLandmarks(new Float64Array(0), 2, 0, 5);
    expect(result.landmarkIndices).toHaveLength(0);
    expect(result.coveringRadius).toBe(0);
  });
});

describe("computeSparseRipsHomology: proven bound holds (d_B <= 2 * coveringRadius)", () => {
  it("holds across many random 2D/3D configs, dim 0 and 1 (maxDim=2)", () => {
    const rng = mulberry32(100);
    let checked = 0;
    for (let trial = 0; trial < 150; trial++) {
      const n = 12 + Math.floor(rng() * 25); // 12..36
      const dims = rng() < 0.5 ? 2 : 3;
      const numLandmarks = Math.max(3, Math.floor(n * (0.3 + rng() * 0.4))); // 30%-70% of n
      const maxDist = 0.3 + rng() * 0.5;
      const pts = randomPoints(rng, n, dims);

      const exact = computePersistentHomology(pts, dims, maxDist, 2);
      const approx = computeSparseRipsHomology(
        pts,
        dims,
        n,
        numLandmarks,
        maxDist,
        2
      );

      for (const dim of [0, 1]) {
        const db = bottleneckDistance(exact.pairs, approx.pairs, dim);
        // Small numerical slack: bottleneckDistance itself binary-searches
        // to a tolerance (default 1e-6), and truncation-boundary pairs (see
        // sparse-rips.ts's CAVEAT) are excluded by keeping maxDist well
        // above typical pair values in this random-point regime.
        if (db !== Infinity) {
          expect(db).toBeLessThanOrEqual(approx.bottleneckBound + 1e-6);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200); // sanity: the loop actually exercised real (non-Infinity) comparisons
  });

  it("holds across a smaller sweep including H2 (maxDim=3)", () => {
    const rng = mulberry32(200);
    let checked = 0;
    for (let trial = 0; trial < 30; trial++) {
      const n = 12 + Math.floor(rng() * 13); // 12..25 (H2 is expensive; keep n modest)
      const dims = 3;
      const numLandmarks = Math.max(4, Math.floor(n * (0.4 + rng() * 0.4)));
      const maxDist = 0.4 + rng() * 0.4;
      const pts = randomPoints(rng, n, dims);

      const exact = computePersistentHomology(pts, dims, maxDist, 3);
      const approx = computeSparseRipsHomology(
        pts,
        dims,
        n,
        numLandmarks,
        maxDist,
        3
      );

      for (const dim of [0, 1, 2]) {
        const db = bottleneckDistance(exact.pairs, approx.pairs, dim);
        if (db !== Infinity) {
          expect(db).toBeLessThanOrEqual(approx.bottleneckBound + 1e-6);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("holds on real data (UCI Iris, 150 points, R^4)", () => {
    const csvPath = path.join(
      import.meta.dirname,
      "..",
      "bench",
      "data",
      "iris.csv"
    );
    const raw = readFileSync(csvPath, "utf-8").trim().split("\n");
    const dims = 4;
    const n = raw.length;
    const flat = new Float64Array(n * dims);
    for (let i = 0; i < n; i++) {
      const cols = raw[i]!.split(",");
      for (let d = 0; d < dims; d++) {
        flat[i * dims + d] = Number(cols[d]!);
      }
    }
    const colMin = new Float64Array(dims).fill(Infinity);
    const colMax = new Float64Array(dims).fill(-Infinity);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dims; d++) {
        const v = flat[i * dims + d]!;
        if (v < colMin[d]!) {
          colMin[d] = v;
        }
        if (v > colMax[d]!) {
          colMax[d] = v;
        }
      }
    }
    const norm = new Float64Array(n * dims);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dims; d++) {
        norm[i * dims + d] =
          (flat[i * dims + d]! - colMin[d]!) / (colMax[d]! - colMin[d]!);
      }
    }

    const maxDist = 0.35;
    const exact = computePersistentHomology(norm, dims, maxDist, 2);
    const approx = computeSparseRipsHomology(norm, dims, n, 60, maxDist, 2);

    for (const dim of [0, 1]) {
      const db = bottleneckDistance(exact.pairs, approx.pairs, dim);
      if (db !== Infinity) {
        expect(db).toBeLessThanOrEqual(approx.bottleneckBound + 1e-6);
      }
    }
  });

  it("numLandmarks = n reproduces the exact diagram exactly (bound = 0)", () => {
    const rng = mulberry32(300);
    const n = 20;
    const dims = 2;
    const pts = randomPoints(rng, n, dims);
    const maxDist = 0.5;

    const exact = computePersistentHomology(pts, dims, maxDist, 2);
    const approx = computeSparseRipsHomology(pts, dims, n, n, maxDist, 2);

    expect(approx.coveringRadius).toBe(0);
    expect(approx.bottleneckBound).toBe(0);
    for (const dim of [0, 1]) {
      expect(bottleneckDistance(exact.pairs, approx.pairs, dim)).toBe(0);
    }
  });

  it("landmarkIndices are returned and index into the original point cloud", () => {
    const rng = mulberry32(400);
    const n = 25;
    const pts = randomPoints(rng, n, 2);
    const approx = computeSparseRipsHomology(pts, 2, n, 10, 0.5, 2);
    expect(approx.landmarkIndices).toHaveLength(10);
    for (const idx of approx.landmarkIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(n);
    }
  });
});

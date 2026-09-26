/**
 * Golden barcodes for the real datasets the shared-primitive hoist touched.
 *
 * The hoist in 0bb99ce replaced five inlined copies of the same logic with
 * calls to `computeH0Phase`, `buildFlippedTetrahedronCoboundary`, the
 * `squaredEuclideanDistance` helper and the landmark distance function. Its
 * only test was one hand-picked two-tetrahedron fixture with hardcoded
 * arrays, which proves nothing about H0 or H1 at scale.
 *
 * These hashes were produced by running `bench/hoist-diff.ts` against the
 * hoist's parent (ad03387) and against the hoist itself, over four real
 * datasets at two thresholds each and maxDim 1 and 2. All 128 compared lines
 * were byte-identical, which is the evidence the hoist changed no behaviour.
 * This file pins the post-hoist values so a FUTURE refactor of any of those
 * primitives fails here instead of silently changing a barcode.
 *
 * The thresholds sit below each dataset's saturation point, where the
 * enclosing-radius clamp stops adding edges, so every row is a distinct
 * complex rather than a repeat. maxDim 2 is included because H2 is what
 * `buildFlippedTetrahedronCoboundary` actually drives.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HomologyResult } from "../src/core/homology-unified.ts";
import { computePersistentHomology } from "../src/index.ts";

const ENGINES = [
  "auto",
  "standard",
  "cohomology",
  "implicit",
  "implicit-full",
  "fast",
] as const;

const GOLDEN = [
  {
    dims: 13,
    expected: "6b91b70a",
    file: "wine.csv",
    maxDim: 1,
    maxDist: 0.45,
  },
  {
    dims: 13,
    expected: "6adcb55f",
    file: "wine.csv",
    maxDim: 2,
    maxDist: 0.45,
  },
  { dims: 13, expected: "f80e0181", file: "wine.csv", maxDim: 1, maxDist: 0.8 },
  { dims: 13, expected: "1309f064", file: "wine.csv", maxDim: 2, maxDist: 0.8 },
  { dims: 60, expected: "52812e3a", file: "sonar.csv", maxDim: 1, maxDist: 2 },
  { dims: 60, expected: "464a4a4b", file: "sonar.csv", maxDim: 2, maxDist: 2 },
  { dims: 60, expected: "7f6da97c", file: "sonar.csv", maxDim: 1, maxDist: 3 },
  { dims: 60, expected: "988e6953", file: "sonar.csv", maxDim: 2, maxDist: 3 },
  {
    dims: 7,
    expected: "33ab7d29",
    file: "seeds.csv",
    maxDim: 1,
    maxDist: 0.35,
  },
  {
    dims: 7,
    expected: "22334017",
    file: "seeds.csv",
    maxDim: 2,
    maxDist: 0.35,
  },
  { dims: 7, expected: "7176f6dc", file: "seeds.csv", maxDim: 1, maxDist: 0.6 },
  { dims: 7, expected: "9dc933fe", file: "seeds.csv", maxDim: 2, maxDist: 0.6 },
  { dims: 4, expected: "1d11d12e", file: "iris.csv", maxDim: 1, maxDist: 0.35 },
  { dims: 4, expected: "b4167fe4", file: "iris.csv", maxDim: 2, maxDist: 0.35 },
  { dims: 4, expected: "d8914d4a", file: "iris.csv", maxDim: 1, maxDist: 0.6 },
  { dims: 4, expected: "75a4caa0", file: "iris.csv", maxDim: 2, maxDist: 0.6 },
] as const;

function loadMinMax(file: string, dims: number): Float64Array {
  const raw = readFileSync(
    path.join(import.meta.dirname, "..", "bench", "data", file),
    "utf-8"
  )
    .trim()
    .split("\n");
  const n = raw.length;
  const flat = new Float64Array(n * dims);
  for (let i = 0; i < n; i++) {
    const cols = raw[i]!.split(",");
    for (let d = 0; d < dims; d++) {
      flat[i * dims + d] = Number(cols[d]!);
    }
  }
  const lo = new Float64Array(dims).fill(Number.POSITIVE_INFINITY);
  const hi = new Float64Array(dims).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dims; d++) {
      const v = flat[i * dims + d]!;
      if (v < lo[d]!) {
        lo[d] = v;
      }
      if (v > hi[d]!) {
        hi[d] = v;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dims; d++) {
      const span = hi[d]! - lo[d]!;
      flat[i * dims + d] =
        span === 0 ? 0 : (flat[i * dims + d]! - lo[d]!) / span;
    }
  }
  return flat;
}

function hash(s: string): string {
  let h = 0x81_1c_9d_c5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.codePointAt(i)!;
    h = Math.imul(h, 0x01_00_01_93) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function serialize(res: HomologyResult): string {
  return res.pairs
    .map((p) => `${p.dim},${p.birth.toFixed(9)},${p.death.toFixed(9)}`)
    .toSorted()
    .join(";");
}

describe("hoisted primitives produce unchanged real-data barcodes", () => {
  // it.each, not a for-loop, so a failing row names its own case. The 60s
  // ceiling is for sonar@3 at maxDim 2: 22k triangles across six engines
  // overruns vitest's 5s default, and it is the only row that reaches the
  // spatial-hash regime, so it stays.
  it.each(GOLDEN)(
    "$file@$maxDist maxDim=$maxDim",
    ({ dims, expected, file, maxDim, maxDist }) => {
      const pts = loadMinMax(file, dims);
      for (const engine of ENGINES) {
        const res = computePersistentHomology(pts, dims, {
          engine,
          maxDim,
          maxDist,
        });
        expect(`${engine} ${hash(serialize(res))}`).toBe(
          `${engine} ${expected}`
        );
      }
    },
    60_000
  );
});

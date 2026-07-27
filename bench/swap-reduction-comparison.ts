/**
 * Standalone before/after comparison for the swap-reduction variant added to
 * computePersistentHomologyCohomology (src/core/homology-cohom.ts), applying
 * Bauer, Bin Masood, Giunti, Houry, Kerber, Rathod, "Keeping it sparse:
 * Computing Persistent Homology revisited" (arXiv:2211.09075, 2024).
 *
 * This script is deliberately self-contained (its own CSV loader, its own
 * timing/memory harness) rather than reaching into bench/benchmark.ts's
 * DATASETS registry, because the comparison methodology here is: run this
 * EXACT SAME script unmodified from two different checkouts (git HEAD before
 * this session's swap-reduction change, vs. the current working tree with
 * it) and diff the printed numbers. Depending on bench/benchmark.ts (which
 * itself changed during an earlier, unrelated session) would confound the
 * comparison with unrelated harness drift between the two checkouts.
 *
 * Real data only (per CLAUDE.md's real-data-only benchmark policy): UCI
 * Wine (178 x 13D) and UCI Iris (150 x 4D), both already vendored in
 * bench/data/ for the rest of this repo's benchmarks. maxDist values are
 * chosen on the denser end of each dataset's already-established sweep
 * range in bench/benchmark.ts's DATASETS registry, since swap reduction's
 * owner-lookup/cascade branch only fires when cycle edges' cascades
 * actually collide on shared pivots -- sparse complexes barely exercise it.
 *
 * Usage: node --experimental-strip-types --expose-gc bench/swap-reduction-comparison.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { computePersistentHomologyCohomology } from "../src/core/homology-cohom.ts";

const __dirname = import.meta.dirname;

function loadMultiDimCsv(filename: string, dims: number): Float64Array {
  const csvPath = path.join(__dirname, "data", filename);
  const raw = readFileSync(csvPath, "utf-8").trim().split("\n");
  const n = raw.length;
  const flat = new Float64Array(n * dims);
  for (let i = 0; i < n; i++) {
    const cols = raw[i]!.split(",");
    for (let d = 0; d < dims; d++) {
      flat[i * dims + d] = Number(cols[d]!);
    }
  }
  const colMin = new Float64Array(dims).fill(Number.POSITIVE_INFINITY);
  const colMax = new Float64Array(dims).fill(Number.NEGATIVE_INFINITY);
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
  const out = new Float64Array(n * dims);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dims; d++) {
      out[i * dims + d] =
        (flat[i * dims + d]! - colMin[d]!) / (colMax[d]! - colMin[d]!);
    }
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function timeMedianMs(
  fn: () => unknown,
  trials: number,
  warmup: number
): number {
  for (let i = 0; i < warmup; i++) {
    fn();
  }
  const samples: number[] = [];
  for (let i = 0; i < trials; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

function forceGc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g === "function") {
    g();
  }
}

function heapDeltaMBMedian(fn: () => unknown, repeats: number): number {
  const samples: number[] = [];
  for (let i = 0; i < repeats; i++) {
    forceGc();
    const before = process.memoryUsage().heapUsed;
    const handle = fn();
    forceGc();
    const after = process.memoryUsage().heapUsed;
    void handle;
    samples.push((after - before) / (1024 * 1024));
  }
  return median(samples);
}

const hasGc = typeof (globalThis as { gc?: () => void }).gc === "function";
console.log(
  `swap-reduction comparison (${hasGc ? "GC forced via --expose-gc" : "NO --expose-gc detected -- memory numbers will be noisier, timing unaffected"})`
);

const cases: {
  name: string;
  points: Float64Array;
  dims: number;
  maxDist: number;
}[] = [
  {
    dims: 13,
    maxDist: 0.45,
    name: "UCI Wine (178x13D) maxDist=0.45",
    points: loadMultiDimCsv("wine.csv", 13),
  },
  {
    dims: 13,
    maxDist: 0.5,
    name: "UCI Wine (178x13D) maxDist=0.5 (denser)",
    points: loadMultiDimCsv("wine.csv", 13),
  },
  {
    dims: 60,
    maxDist: 1.6,
    name: "UCI Sonar (208x60D) maxDist=1.6",
    points: loadMultiDimCsv("sonar.csv", 60),
  },
  {
    dims: 7,
    maxDist: 0.35,
    name: "UCI Seeds (210x7D) maxDist=0.35",
    points: loadMultiDimCsv("seeds.csv", 7),
  },
  {
    dims: 4,
    maxDist: 0.35,
    name: "UCI Iris (150x4D, normalized) maxDist=0.35",
    points: loadMultiDimCsv("iris.csv", 4),
  },
];

for (const c of cases) {
  const run = () =>
    computePersistentHomologyCohomology(c.points, c.dims, c.maxDist, 2);
  const result = run();
  const timeMs = timeMedianMs(run, 12, 3);
  const heapMB = heapDeltaMBMedian(run, 9);
  console.log(
    `${c.name}: n=${result.complex.numVertices} edges=${result.complex.numEdges} triangles=${result.complex.numTriangles} | time_median_ms=${timeMs.toFixed(3)} heap_delta_median_MB=${heapMB.toFixed(4)}`
  );
}

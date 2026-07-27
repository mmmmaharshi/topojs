/**
 * Standalone before/after comparison for computePersistentHomologyReduced
 * (src/core/homology-reduced.ts), the new H0+H1 engine built on the
 * "reduced Vietoris-Rips complex" of Koyama, Memoli, Robins, Turner,
 * "Faster computation of degree-1 persistent homology using the reduced
 * Vietoris-Rips filtration" (arXiv:2307.16333, 2023/2024).
 *
 * Baseline: computePersistentHomology(points, dims, maxDist, 1) -- the
 * existing standard engine, called with maxDim=1 so it only RETURNS H0+H1
 * pairs, but it still has to build the FULL triangle set internally (2-
 * simplices are needed to compute which edges/cycles get killed, regardless
 * of what maxDim the caller asked for -- buildRipsComplex does not gate
 * triangle construction on maxDim). That "still pays for all triangles even
 * though it only wants H1" cost is exactly the inefficiency the reduced
 * complex targets, so this is the correct, fair baseline -- not a strawman.
 *
 * This script is deliberately self-contained (its own CSV loader, its own
 * timing/memory harness, its own correctness check), matching the
 * methodology already established by bench/swap-reduction-comparison.ts in
 * this repo: run the exact same script from two checkouts and diff the
 * numbers, without depending on bench/benchmark.ts (which serves a
 * different, streaming-focused purpose and may drift independently).
 *
 * Real data only (per CLAUDE.md's real-data-only benchmark policy): UCI
 * Wine (178x13D), UCI Sonar (208x60D), UCI Seeds (210x7D), UCI Iris
 * (150x4D), and the Jazz musicians collaboration network (198 nodes, graph
 * Laplacian 3D embedding) -- all already vendored in bench/data/ or
 * src/data/realworld-datasets.ts for this repo's other benchmarks. For each
 * dataset, two maxDist values are swept: a sparser one (near the low end of
 * the dataset's established sweep range in bench/benchmark.ts's DATASETS
 * registry) and a denser one (near the high end), since the reduced
 * complex's win should scale with how crowded the neighborhoods are.
 *
 * Usage: node --experimental-strip-types --expose-gc bench/reduced-vr-comparison.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { computePersistentHomologyReduced } from "../src/core/homology-reduced.ts";
import { computePersistentHomology } from "../src/core/homology.ts";

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

/** Jazz is already a graph-Laplacian embedding at its own natural scale
 * (unnormalized, per bench/benchmark.ts's DATASETS.jazz), so load it raw. */
function loadJazzRaw(): Float64Array {
  const csvPath = path.join(__dirname, "data", "jazz.csv");
  const raw = readFileSync(csvPath, "utf-8").trim().split("\n");
  const n = raw.length;
  const flat = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const cols = raw[i]!.split(",");
    for (let d = 0; d < 3; d++) {
      flat[i * 3 + d] = Number(cols[d]!);
    }
  }
  return flat;
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

/** Canonicalize {dim,birth,death} pairs for an order-independent equality
 * check (matches test/homology-reduced.test.ts's canon() convention). */
function canon(pairs: { dim: number; birth: number; death: number }[]): string {
  return JSON.stringify(
    pairs
      .map((p) => ({ birth: p.birth, death: p.death, dim: p.dim }))
      .toSorted(
        (a, b) => a.dim - b.dim || a.birth - b.birth || a.death - b.death
      )
  );
}

const hasGc = typeof (globalThis as { gc?: () => void }).gc === "function";
console.log(
  `reduced-VR-complex comparison (${hasGc ? "GC forced via --expose-gc" : "NO --expose-gc detected -- memory numbers will be noisier, timing unaffected"})`
);
console.log(
  "baseline = computePersistentHomology(..., maxDim=1)  |  new = computePersistentHomologyReduced\n"
);

const cases: {
  name: string;
  points: Float64Array;
  dims: number;
  maxDist: number;
  /** Overrides for slow cases (baseline pays full O(n^3)-ish triangle cost,
   * which gets impractically slow to replicate 12x at the denser end --
   * exactly the regime this technique targets). Defaults: trials=12,
   * warmup=3, heapRepeats=9. */
  trials?: number;
  warmup?: number;
  heapRepeats?: number;
}[] = [
  {
    dims: 13,
    maxDist: 0.25,
    name: "UCI Wine (178x13D) maxDist=0.25 (sparser)",
    points: loadMultiDimCsv("wine.csv", 13),
  },
  {
    dims: 13,
    maxDist: 0.45,
    name: "UCI Wine (178x13D) maxDist=0.45 (denser)",
    points: loadMultiDimCsv("wine.csv", 13),
  },
  {
    dims: 60,
    maxDist: 1.4,
    name: "UCI Sonar (208x60D) maxDist=1.4 (sparser)",
    points: loadMultiDimCsv("sonar.csv", 60),
  },
  {
    dims: 60,
    maxDist: 2,
    name: "UCI Sonar (208x60D) maxDist=2.0 (denser)",
    points: loadMultiDimCsv("sonar.csv", 60),
  },
  {
    dims: 7,
    maxDist: 0.15,
    name: "UCI Seeds (210x7D) maxDist=0.15 (sparser)",
    points: loadMultiDimCsv("seeds.csv", 7),
  },
  {
    dims: 7,
    maxDist: 0.35,
    name: "UCI Seeds (210x7D) maxDist=0.35 (denser)",
    points: loadMultiDimCsv("seeds.csv", 7),
  },
  {
    dims: 4,
    maxDist: 0.2,
    name: "UCI Iris (150x4D, normalized) maxDist=0.2 (sparser)",
    points: loadMultiDimCsv("iris.csv", 4),
  },
  {
    dims: 4,
    maxDist: 0.35,
    name: "UCI Iris (150x4D, normalized) maxDist=0.35 (denser)",
    points: loadMultiDimCsv("iris.csv", 4),
  },
  {
    dims: 3,
    heapRepeats: 2,
    maxDist: 0.15,
    name: "Jazz musicians (198x3D Laplacian embedding) maxDist=0.15 (sparser)",
    points: loadJazzRaw(),
    trials: 3,
    warmup: 0,
  },
  {
    dims: 3,
    heapRepeats: 1,
    maxDist: 0.2,
    name: "Jazz musicians (198x3D Laplacian embedding) maxDist=0.2 (denser, baseline ~9s/call -- this is exactly the crowded regime the reduced complex targets)",
    points: loadJazzRaw(),
    trials: 1,
    warmup: 0,
  },
];

// Optional CLI filter (matches bench/benchmark.ts's "run just one" convention):
// `node ... reduced-vr-comparison.ts jazz` runs only cases whose name
// contains "jazz" (case-insensitive). Exists so the Jazz "denser" case --
// whose baseline alone takes ~9-22s per call, exactly the crowded regime
// this technique targets -- can be run and timed on its own.
const filter = process.argv[2]?.toLowerCase();
const activeCases = filter
  ? cases.filter((c) => c.name.toLowerCase().includes(filter))
  : cases;

let anyMismatch = false;

for (const c of activeCases) {
  const runBaseline = () =>
    computePersistentHomology(c.points, c.dims, c.maxDist, 1);
  const runNew = () =>
    computePersistentHomologyReduced(c.points, c.dims, c.maxDist);

  const baseResult = runBaseline();
  const newResult = runNew();

  const baseCanon = canon(baseResult.pairs.filter((p) => p.dim <= 1));
  const newCanon = canon(newResult.pairs);
  const matches = baseCanon === newCanon;
  if (!matches) {
    anyMismatch = true;
  }

  const trials = c.trials ?? 12;
  const warmup = c.warmup ?? 3;
  const heapRepeats = c.heapRepeats ?? 9;
  const baseTimeMs = timeMedianMs(runBaseline, trials, warmup);
  const newTimeMs = timeMedianMs(runNew, trials, warmup);
  const baseHeapMB = heapDeltaMBMedian(runBaseline, heapRepeats);
  const newHeapMB = heapDeltaMBMedian(runNew, heapRepeats);

  const speedup = baseTimeMs / newTimeMs;
  const triRatioPct =
    (100 * newResult.complex.numTriangles) / baseResult.complex.numTriangles;
  const heapRatioPct =
    baseHeapMB > 0 ? (100 * newHeapMB) / baseHeapMB : Number.NaN;

  console.log(`${c.name}:`);
  console.log(
    `  correctness: ${matches ? "MATCH" : "MISMATCH <-- BUG"} (n=${baseResult.complex.numVertices} edges=${baseResult.complex.numEdges})`
  );
  console.log(
    `  triangles:   baseline=${baseResult.complex.numTriangles}  reduced=${newResult.complex.numTriangles}  (${triRatioPct.toFixed(1)}% of baseline)`
  );
  console.log(
    `  time_ms:     baseline=${baseTimeMs.toFixed(3)}  reduced=${newTimeMs.toFixed(3)}  (${speedup.toFixed(2)}x speedup)`
  );
  console.log(
    `  heap_MB:     baseline=${baseHeapMB.toFixed(4)}  reduced=${newHeapMB.toFixed(4)}  (${heapRatioPct.toFixed(1)}% of baseline)`
  );
  console.log();
}

if (anyMismatch) {
  console.log(
    "!!! At least one dataset MISMATCHED between baseline and reduced engine -- investigate before trusting any of the above numbers. !!!"
  );
  process.exitCode = 1;
} else {
  console.log(
    "All datasets: reduced-VR-complex engine's H0+H1 barcode MATCHES the standard engine's, across every maxDist tested above."
  );
}

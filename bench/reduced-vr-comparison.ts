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
 * Real data only (per AGENTS.md's real-data-only benchmark policy): UCI
 * Wine (178x13D), UCI Sonar (208x60D), UCI Seeds (210x7D), UCI Iris
 * (150x4D), the Jazz musicians collaboration network (198 nodes, graph
 * Laplacian 3D embedding), and monthly sunspots (2795x2D delay embedding) --
 * all already vendored in bench/data/ or
 * src/data/realworld-datasets.ts for this repo's other benchmarks. For each
 * dataset, two maxDist values are swept: a sparser one and a denser one, since
 * the reduced complex's win should scale with neighborhood density. The
 * sunspots pair uses 0.005 and 0.02 because the full H1 baseline at 0.05 is
 * too slow for the 2780-point delay embedding.
 *
 * Usage: node --experimental-strip-types --expose-gc bench/reduced-vr-comparison.ts
 * Add --collapse to measure the opt-in collapsed reduced path as well.
 * Use --public-matrix to compare the public unified engine candidates.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isCombinatorialIndexLimitError } from "../src/core/combinatorial-index.ts";
import {
  buildImplicitRipsComplex,
  countImplicitTriangles,
} from "../src/core/complex-implicit.ts";
import { computePersistentHomologyReduced } from "../src/core/homology-reduced.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import type { HomologyResult } from "../src/core/homology.ts";
import * as topojs from "../src/index.ts";

const computePublic = topojs.advanced.computePersistentHomology;
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

function autocorrelation(series: number[], lag: number): number {
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
  let numerator = 0;
  let denominator = 0;
  for (const value of series) {
    denominator += (value - mean) ** 2;
  }
  for (let i = 0; i + lag < series.length; i++) {
    numerator += (series[i]! - mean) * (series[i + lag]! - mean);
  }
  return numerator / denominator;
}

function dataDrivenLag(
  series: number[],
  maxScan: number,
  fallback: number
): number {
  const threshold = 1 / Math.E;
  for (let candidate = 2; candidate <= maxScan; candidate++) {
    if (autocorrelation(series, candidate) < threshold) {
      return candidate;
    }
  }
  return fallback;
}

function delayEmbed2D(series: number[], lag: number): number[][] {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const normalize = (value: number): number => (value - min) / (max - min);
  const points: number[][] = [];
  for (let i = 0; i + lag < series.length; i++) {
    points.push([normalize(series[i]!), normalize(series[i + lag]!)]);
  }
  return points;
}

function loadSunspotsDelayEmbedded(): Float64Array {
  const csvPath = path.join(__dirname, "data", "monthly-sunspots.csv");
  const raw = readFileSync(csvPath, "utf-8").trim().split("\n").slice(1);
  const values = raw.map((line) => Number(line.split(",")[1]!));
  const lag = dataDrivenLag(values, 40, 6);
  const points = delayEmbed2D(values, lag);
  console.log(`monthly sunspots: lag=${lag}, points=${points.length}`);
  return new Float64Array(points.flat());
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

const publicMatrix = process.argv.includes("--public-matrix");
const hasGc = typeof (globalThis as { gc?: () => void }).gc === "function";
console.log(
  publicMatrix
    ? `public auto-engine matrix (${hasGc ? "GC forced via --expose-gc" : "NO --expose-gc detected"})`
    : `reduced-VR-complex comparison (${hasGc ? "GC forced via --expose-gc" : "NO --expose-gc detected -- memory numbers will be noisier, timing unaffected"})`
);
console.log(
  publicMatrix
    ? "candidates = auto, cohomology, implicit-full, reduced, reduced-collapse\n"
    : "baseline = computePersistentHomology(..., maxDim=1)  |  new = computePersistentHomologyReduced\n"
);

interface BenchmarkCase {
  name: string;
  points: Float64Array;
  dims: number;
  maxDist: number;
  trials?: number;
  warmup?: number;
  heapRepeats?: number;
}

const sunspots = loadSunspotsDelayEmbedded();

const cases: BenchmarkCase[] = [
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
    dims: 2,
    heapRepeats: 3,
    maxDist: 0.005,
    name: "Monthly sunspots (2795x2D delay-embedded) maxDist=0.005 (sparser)",
    points: sunspots,
    trials: 3,
    warmup: 1,
  },
  {
    dims: 2,
    heapRepeats: 3,
    maxDist: 0.02,
    name: "Monthly sunspots (2795x2D delay-embedded) maxDist=0.02 (denser)",
    points: sunspots,
    trials: 3,
    warmup: 1,
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
    name: "Jazz musicians (198x3D Laplacian embedding) maxDist=0.2 (denser)",
    points: loadJazzRaw(),
    trials: 1,
    warmup: 0,
  },
  // Unbounded input. Every other case has a finite cutoff, so this is the only
  // one that reaches the enclosing-radius cap -- the clamp in
  // buildRipsSkeleton that replaces a non-finite maxDist with
  // enclosingRadius(points, dims), and the one code path the on-demand distance
  // work sits next to.
  //
  // Two things make the edge counts here look inconsistent when they are not.
  // "Unbounded" means "out to the enclosing ball", NOT "all pairs":
  // enclosingRadius is a minimum enclosing BALL radius (a min over centres of
  // the max distance to that centre), not the max pairwise distance, so on
  // normalized Iris it clamps Infinity to 0.478. And every edge count printed
  // below is POST-collapse, not the raw 1-skeleton: buildRipsComplex always
  // calls collapseDominatedEdges, taking the collapse's maxDim from its 4th
  // argument (complex.ts:48 -> rips-skeleton.ts:120-122). The standard baseline
  // asks for homology maxDim 1 and so collapses weakly, the reduced engine
  // collapses at maxDim 2. A complete complex would be C(150,2) = 11175, and
  // nothing here is that.
  //
  // So the baseline-vs-reduced edge gap is the collapse, which is the whole
  // point of having the case, and the timings are comparative.
  {
    dims: 4,
    heapRepeats: 1,
    maxDist: Number.POSITIVE_INFINITY,
    name: "UCI Iris (150x4D, normalized) maxDist=Infinity (unbounded, equals enclosing radius)",
    points: loadMultiDimCsv("iris.csv", 4),
    trials: 1,
    warmup: 0,
  },
];

// Optional CLI filter (matches bench/benchmark.ts's "run just one" convention):
// `node ... reduced-vr-comparison.ts jazz` runs only cases whose name
// contains "jazz" (case-insensitive). Exists so the Jazz "denser" case --
// whose baseline alone takes ~9-22s per call, exactly the crowded regime
// this technique targets -- can be run and timed on its own.
const args = process.argv.slice(2);
const compareCollapsed = args.includes("--collapse");
const filter = args.find((arg) => !arg.startsWith("--"))?.toLowerCase();
const activeCases = filter
  ? cases.filter((c) => c.name.toLowerCase().includes(filter))
  : cases;

type PublicCandidate =
  | "auto"
  | "cohomology"
  | "implicit-full"
  | "reduced"
  | "reduced-collapse";

interface PublicCandidateResult {
  edges?: number;
  error?: string;
  name: PublicCandidate;
  pairs?: string;
  status: "ok" | "mismatch" | "unavailable" | "error";
  timeMs: number | null;
  triangles?: number;
}

interface PreflightSignals {
  status: "ok" | "unavailable" | "error";
  n: number;
  dims: number;
  maxDim: 1;
  maxDist: number;
  finiteCutoff: boolean;
  edges?: number;
  averageDegree?: number;
  triangles?: number;
  error?: string;
}

function collectPreflightSignals(c: BenchmarkCase): PreflightSignals {
  const n = c.points.length / c.dims;
  const base = {
    dims: c.dims,
    finiteCutoff: Number.isFinite(c.maxDist),
    maxDim: 1 as const,
    maxDist: c.maxDist,
    n,
  };
  try {
    const complex = buildImplicitRipsComplex(c.points, c.dims, c.maxDist);
    const edges = complex.edges.length;
    return {
      ...base,
      averageDegree: (2 * edges) / n,
      edges,
      status: "ok",
      triangles: countImplicitTriangles(complex),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expectedLimit = isCombinatorialIndexLimitError(error);
    return {
      ...base,
      error: message,
      status: expectedLimit ? "unavailable" : "error",
    };
  }
}

function publicCandidateSpecs(c: BenchmarkCase): {
  name: PublicCandidate;
  run: () => HomologyResult;
}[] {
  return [
    {
      name: "auto",
      run: () =>
        computePublic(c.points, c.dims, {
          engine: "auto",
          maxDim: 1,
          maxDist: c.maxDist,
        }),
    },
    {
      name: "cohomology",
      run: () =>
        computePublic(c.points, c.dims, {
          engine: "cohomology",
          maxDim: 1,
          maxDist: c.maxDist,
        }),
    },
    {
      name: "implicit-full",
      run: () =>
        computePublic(c.points, c.dims, {
          engine: "implicit-full",
          maxDim: 1,
          maxDist: c.maxDist,
        }),
    },
    {
      name: "reduced",
      run: () =>
        computePublic(c.points, c.dims, {
          engine: "reduced",
          maxDim: 1,
          maxDist: c.maxDist,
        }),
    },
    {
      name: "reduced-collapse",
      run: () =>
        computePublic(c.points, c.dims, {
          collapse: true,
          engine: "reduced",
          maxDim: 1,
          maxDist: c.maxDist,
        }),
    },
  ];
}

function runPublicCandidate(
  c: BenchmarkCase,
  name: PublicCandidate,
  run: () => HomologyResult
): PublicCandidateResult {
  try {
    const result = run();
    const timeMs = timeMedianMs(run, c.trials ?? 12, c.warmup ?? 3);
    return {
      edges: result.complex.numEdges,
      name,
      pairs: canon(result.pairs.filter((pair) => pair.dim <= 1)),
      status: "ok",
      timeMs,
      triangles: result.complex.numTriangles,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: message,
      name,
      status: isCombinatorialIndexLimitError(error) ? "unavailable" : "error",
      timeMs: null,
    };
  }
}

function runPublicMatrix(
  activeMatrixCases: BenchmarkCase[],
  activeFilter: string | undefined
): void {
  const lines: string[] = [
    "PUBLIC AUTO-ENGINE MATRIX",
    "scope=maxDim:1; reference=cohomology; candidates=auto,cohomology,implicit-full,reduced,reduced-collapse; counts=engine-reported; preflight_basis=implicit-collapse; preflight_counts_are_collapsed=true; preflight_saturates=always",
    `generated=${new Date().toISOString()}`,
    "",
  ];
  let anyMismatch = false;

  for (const c of activeMatrixCases) {
    const signals = collectPreflightSignals(c);
    if (signals.status === "error") {
      anyMismatch = true;
    }
    const results = publicCandidateSpecs(c).map(({ name, run }) => {
      forceGc();
      return runPublicCandidate(c, name, run);
    });
    const reference = results.find(
      (result) => result.name === "cohomology" && result.status === "ok"
    );
    if (!reference?.pairs && results.some((result) => result.status === "ok")) {
      anyMismatch = true;
      lines.push("  agreement: unavailable (cohomology reference failed)");
    }
    for (const result of results) {
      if (result.status === "error") {
        anyMismatch = true;
      }
      if (result.status !== "ok" || !result.pairs || !reference?.pairs) {
        continue;
      }
      if (result.pairs !== reference.pairs) {
        result.status = "mismatch";
        anyMismatch = true;
      }
    }

    const signalLine =
      signals.status === "ok"
        ? `  signals: n=${signals.n} dims=${signals.dims} maxDim=1 maxDist=${signals.maxDist} finite=${signals.finiteCutoff} epsilon=none trials=${c.trials ?? 12} warmup=${c.warmup ?? 3} E_preflight=${signals.edges} avg_degree_preflight=${signals.averageDegree?.toFixed(2)} T_g_preflight=${signals.triangles} reference=cohomology`
        : `  signals: n=${signals.n} dims=${signals.dims} maxDim=1 maxDist=${signals.maxDist} finite=${signals.finiteCutoff} epsilon=none trials=${c.trials ?? 12} warmup=${c.warmup ?? 3} preflight=${signals.status} (${signals.error}) reference=cohomology`;
    const resultLines = results.map((result) => {
      if (
        (result.status === "ok" || result.status === "mismatch") &&
        result.pairs
      ) {
        return `  ${result.name}: ${result.timeMs?.toFixed(3)}ms edges_reported=${result.edges} triangles_reported=${result.triangles} status=${result.status}`;
      }
      if (result.status === "error") {
        return `  ${result.name}: error${result.error ? ` (${result.error})` : ""}`;
      }
      return `  ${result.name}: unavailable${result.error ? ` (${result.error})` : ""}`;
    });
    lines.push(c.name, signalLine, ...resultLines, "");
  }

  console.log(lines.join("\n"));
  if (!activeFilter) {
    const outputPath = path.join(
      __dirname,
      "data",
      "auto_engine_matrix_results.txt"
    );
    writeFileSync(outputPath, `${lines.join("\n").trimEnd()}\n`);
    console.log(`Wrote ${outputPath}`);
  }
  if (anyMismatch) {
    console.error("public matrix found a candidate barcode mismatch");
    process.exitCode = 1;
  }
}

let legacyMismatch = false;
if (filter && activeCases.length === 0) {
  console.error(`No benchmark cases matched filter: ${filter}`);
  process.exitCode = 1;
} else if (publicMatrix) {
  runPublicMatrix(activeCases, filter);
} else {
  for (const c of activeCases) {
    const runBaseline = () =>
      computePersistentHomology(c.points, c.dims, c.maxDist, 1);
    const runNew = () =>
      computePersistentHomologyReduced(c.points, c.dims, c.maxDist);
    const runCollapsed = () =>
      computePersistentHomologyReduced(c.points, c.dims, c.maxDist, true);

    const baseResult = runBaseline();
    const newResult = runNew();
    const collapsedResult = compareCollapsed ? runCollapsed() : undefined;

    const baseCanon = canon(baseResult.pairs.filter((p) => p.dim <= 1));
    const newCanon = canon(newResult.pairs);
    const matches = baseCanon === newCanon;
    const collapsedCanon = collapsedResult
      ? canon(collapsedResult.pairs)
      : undefined;
    const collapsedMatches =
      collapsedCanon === undefined || collapsedCanon === baseCanon;
    if (!matches || !collapsedMatches) {
      legacyMismatch = true;
    }

    const trials = c.trials ?? 12;
    const warmup = c.warmup ?? 3;
    const heapRepeats = c.heapRepeats ?? 9;
    const baseTimeMs = timeMedianMs(runBaseline, trials, warmup);
    const newTimeMs = timeMedianMs(runNew, trials, warmup);
    const baseHeapMB = heapDeltaMBMedian(runBaseline, heapRepeats);
    const newHeapMB = heapDeltaMBMedian(runNew, heapRepeats);
    const collapsedTimeMs = compareCollapsed
      ? timeMedianMs(runCollapsed, trials, warmup)
      : Number.NaN;
    const collapsedHeapMB = compareCollapsed
      ? heapDeltaMBMedian(runCollapsed, heapRepeats)
      : Number.NaN;

    const speedup = baseTimeMs / newTimeMs;
    const triRatioPct =
      baseResult.complex.numTriangles > 0
        ? (100 * newResult.complex.numTriangles) /
          baseResult.complex.numTriangles
        : Number.NaN;
    const heapRatioPct =
      baseHeapMB > 0 ? (100 * newHeapMB) / baseHeapMB : Number.NaN;

    console.log(`${c.name}:`);
    const n = baseResult.complex.numVertices;
    const oldMatrixBytes = 8 * ((n * (n - 1)) / 2) + 4 * n;
    console.log(
      `  correctness: ${matches ? "MATCH" : "MISMATCH <-- BUG"} (n=${n} edges=${baseResult.complex.numEdges})`
    );
    console.log(
      `  old_reduced_matrix_bytes: ${(oldMatrixBytes / (1024 * 1024)).toFixed(2)}MiB`
    );
    const triRatioText = Number.isFinite(triRatioPct)
      ? `${triRatioPct.toFixed(1)}%`
      : "n/a";
    console.log(
      `  triangles:   baseline=${baseResult.complex.numTriangles}  reduced=${newResult.complex.numTriangles}  (${triRatioText} of baseline)`
    );
    console.log(
      `  time_ms:     baseline=${baseTimeMs.toFixed(3)}  reduced=${newTimeMs.toFixed(3)}  (${speedup.toFixed(2)}x speedup)`
    );
    console.log(
      `  heap_MB:     baseline=${baseHeapMB.toFixed(4)}  reduced=${newHeapMB.toFixed(4)}  (${heapRatioPct.toFixed(1)}% of baseline)`
    );
    if (collapsedResult) {
      const collapsedTriRatioPct =
        baseResult.complex.numTriangles > 0
          ? (100 * collapsedResult.complex.numTriangles) /
            baseResult.complex.numTriangles
          : Number.NaN;
      const collapsedHeapRatioPct =
        baseHeapMB > 0 ? (100 * collapsedHeapMB) / baseHeapMB : Number.NaN;
      const collapsedTriRatioText = Number.isFinite(collapsedTriRatioPct)
        ? `${collapsedTriRatioPct.toFixed(1)}%`
        : "n/a";
      console.log(
        `  collapsed:   edges=${collapsedResult.complex.numEdges}  triangles=${collapsedResult.complex.numTriangles} (${collapsedTriRatioText} of baseline)  correctness=${collapsedMatches ? "MATCH" : "MISMATCH <-- BUG"}`
      );
      console.log(
        `  collapsed_time_ms: ${collapsedTimeMs.toFixed(3)}  speedup=${(baseTimeMs / collapsedTimeMs).toFixed(2)}x  heap_MB=${collapsedHeapMB.toFixed(4)} (${collapsedHeapRatioPct.toFixed(1)}% of baseline)`
      );
    }
    console.log();
  }
}

if (!publicMatrix) {
  if (legacyMismatch) {
    console.log(
      "!!! At least one dataset MISMATCHED between baseline and reduced engine -- investigate before trusting any of the above numbers. !!!"
    );
    process.exitCode = 1;
  } else {
    console.log(
      "All datasets: reduced-VR-complex engine's H0+H1 barcode MATCHES the standard engine's, across every maxDist tested above."
    );
    if (compareCollapsed) {
      console.log(
        "All datasets: collapsed reduced-VR-complex H0+H1 barcode MATCHES the standard engine's."
      );
    }
  }
}

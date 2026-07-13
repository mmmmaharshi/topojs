/**
 * Empirically verifies the claimed per-push complexity formula for
 * IncrementalH1: Theta(E+T) + O(k) + O(deg(new)^2) (see incremental-h1.ts's
 * "PRECISE COMPLEXITY" docstring section). That formula has been asserted
 * and used to EXPLAIN observed behavior (e.g. "O(deg(new)^2) eventually
 * dominates the O(k) term"), but nothing in this repo actually fits it
 * against measured per-push timings -- this does that directly: record
 * (E, T, k, deg(new)) alongside wall-clock time for individual pushes across
 * a range of window sizes on real data, then fit an ordinary-least-squares
 * model `ms ~ b0 + b1*(E+T) + b2*k + b3*deg(new)^2` and report R^2, plus
 * R^2 for single-term alternatives, so the 3-term formula's explanatory
 * power can be compared against simpler stories.
 *
 * Uses real data (this is a performance/complexity claim, so CLAUDE.md's
 * real-data-only benchmark policy applies -- unlike bench/boundary-
 * sensitivity.ts and bench/bound-tightness.ts, which are correctness/bound
 * characterizations and correctly use synthetic sweeps instead).
 *
 * Run: node --experimental-strip-types bench/complexity-fit.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { IncrementalH1 } from "../src/streaming/incremental-h1.ts";

const __dirname = import.meta.dirname;

function loadCsvColumn(filename: string, valueRegex: RegExp): number[] {
  const csvPath = path.join(__dirname, "data", filename);
  const raw = readFileSync(csvPath, "utf-8").trim().split("\n").slice(1);
  return raw.map((line) => {
    const m = line.match(valueRegex);
    if (!m) {
      throw new Error(`unparseable row in ${filename}: ${line}`);
    }
    return Number(m[1]);
  });
}

function minMax(series: number[]): [number, number] {
  return [Math.min(...series), Math.max(...series)];
}

function delayEmbed2D(series: number[], lag: number): number[][] {
  const [mn, mx] = minMax(series);
  const norm = (v: number) => (v - mn) / (mx - mn);
  const pts: number[][] = [];
  for (let i = 0; i + lag < series.length; i++) {
    pts.push([norm(series[i]!), norm(series[i + lag]!)]);
  }
  return pts;
}

function loadSunspots(): number[][] {
  const monthly = loadCsvColumn(
    "monthly-sunspots.csv",
    /^"\d{4}-\d{2}",(?<value>[\d.]+)/u
  );
  return delayEmbed2D(monthly, 6);
}

function loadMelbourneTemp(): number[][] {
  const daily = loadCsvColumn(
    "daily-min-temperatures.csv",
    /^"[\d-]+",(?<value>[\d.]+)/u
  );
  return delayEmbed2D(daily, 10);
}

function euclidean(a: number[], b: number[]): number {
  let sq = 0;
  for (let d = 0; d < a.length; d++) {
    sq += (a[d]! - b[d]!) ** 2;
  }
  return Math.sqrt(sq);
}

interface Row {
  ms: number;
  eplusT: number;
  k: number;
  degNewSq: number;
}

/**
 * Runs one window-size instance of IncrementalH1 on a real point stream,
 * recording per-push timing plus (E+T), k, and deg(new)^2 for each timed
 * push. deg(new) is computed independently here (Euclidean distance against
 * the sliding window's CURRENT contents, before this push), not read out of
 * the engine's internals -- an independent measurement, not a
 * self-reported one.
 */
function collectRows(
  points: number[][],
  dims: number,
  windowSize: number,
  maxDist: number,
  warmup: number,
  timedSteps: number
): Row[] {
  const engine = new IncrementalH1({ dims, maxDim: 1, maxDist, windowSize });
  const window: number[][] = [];

  const pushOne = (p: number[]) => {
    // deg(new): count of CURRENT window members within maxDist of p, BEFORE
    // this push (matches the "new point's degree in the pre-push graph"
    // quantity the O(deg(new)^2) term refers to).
    let degNew = 0;
    for (const q of window) {
      if (euclidean(p, q) <= maxDist) {
        degNew++;
      }
    }
    window.push(p);
    if (window.length > windowSize) {
      window.shift();
    }
    return degNew;
  };

  for (let i = 0; i < warmup; i++) {
    pushOne(points[i]!);
    engine.push(points[i]!);
  }

  const rows: Row[] = [];
  for (let i = warmup; i < warmup + timedSteps; i++) {
    const degNew = pushOne(points[i]!);
    const start = performance.now();
    const update = engine.push(points[i]!)!;
    const ms = performance.now() - start;
    rows.push({
      degNewSq: degNew * degNew,
      eplusT: update.complex.numEdges + update.complex.numTriangles,
      k: windowSize,
      ms,
    });
  }
  return rows;
}

// ── OLS fit via normal equations (Gauss-Jordan elimination) ──────────────

function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivotRow]![col]!)) {
        pivotRow = r;
      }
    }
    [m[col], m[pivotRow]] = [m[pivotRow]!, m[col]!];
    const pivot = m[col]![col]!;
    if (Math.abs(pivot) < 1e-12) {
      continue; // singular-ish; leave row as-is (degenerate feature)
    }
    for (let c = col; c <= n; c++) {
      m[col]![c]! /= pivot;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) {
        continue;
      }
      const factor = m[r]![col]!;
      for (let c = col; c <= n; c++) {
        m[r]![c]! -= factor * m[col]![c]!;
      }
    }
  }
  return m.map((row) => row[n]!);
}

/** Fits y ~ b0 + b1*x1 + b2*x2 + ... via OLS normal equations, returns coeffs + R^2. */
function fitOLS(
  features: number[][],
  y: number[]
): { coeffs: number[]; r2: number } {
  const n = y.length;
  const p = features[0]!.length + 1; // +1 for intercept
  const design = features.map((row) => [1, ...row]);

  const xtx: number[][] = Array.from({ length: p }, () =>
    Array.from({ length: p }, () => 0)
  );
  const xty: number[] = Array.from({ length: p }, () => 0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      xty[j]! += design[i]![j]! * y[i]!;
      for (let k = 0; k < p; k++) {
        xtx[j]![k]! += design[i]![j]! * design[i]![k]!;
      }
    }
  }
  const coeffs = solveLinearSystem(xtx, xty);

  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = design[i]!.reduce((s, v, j) => s + v * coeffs[j]!, 0);
    ssRes += (y[i]! - pred) ** 2;
    ssTot += (y[i]! - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : Number.NaN;
  return { coeffs, r2 };
}

function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// ── run ────────────────────────────────────────────────────────────────

const datasets: {
  name: string;
  points: number[][];
  maxDist: number;
  windowSizes: number[];
}[] = [
  {
    maxDist: 0.15,
    name: "sunspots",
    points: loadSunspots(),
    windowSizes: [10, 20, 40, 80, 120],
  },
  {
    maxDist: 0.15,
    name: "melbourne-temp",
    points: loadMelbourneTemp(),
    windowSizes: [10, 20, 40, 80, 120, 160],
  },
];

for (const ds of datasets) {
  console.log(`\n=== COMPLEXITY FIT: ${ds.name} ===`);
  const allRows: Row[] = [];
  for (const windowSize of ds.windowSizes) {
    const warmup = windowSize + 5;
    const timedSteps = Math.min(80, ds.points.length - warmup - 5);
    if (timedSteps < 10) {
      continue;
    }
    const rows = collectRows(
      ds.points,
      2,
      windowSize,
      ds.maxDist,
      warmup,
      timedSteps
    );
    allRows.push(...rows);
    console.log(
      `  windowSize=${windowSize}: collected ${rows.length} timed pushes`
    );
  }

  const ks = allRows.map((r) => r.k);
  const eplusTs = allRows.map((r) => r.eplusT);
  const degSqs = allRows.map((r) => r.degNewSq);
  console.log(
    `  predictor correlations: corr(k, E+T)=${corr(ks, eplusTs).toFixed(3)}, ` +
      `corr(k, deg^2)=${corr(ks, degSqs).toFixed(3)}, corr(E+T, deg^2)=${corr(eplusTs, degSqs).toFixed(3)}`
  );

  const y = allRows.map((r) => r.ms);
  const full = fitOLS(
    allRows.map((r) => [r.eplusT, r.k, r.degNewSq]),
    y
  );
  const onlyK = fitOLS(
    allRows.map((r) => [r.k]),
    y
  );
  const onlyDegSq = fitOLS(
    allRows.map((r) => [r.degNewSq]),
    y
  );
  const onlyEplusT = fitOLS(
    allRows.map((r) => [r.eplusT]),
    y
  );

  console.log(
    `\n  n=${allRows.length} total timed pushes across ${ds.windowSizes.length} window sizes`
  );
  console.log(
    `  FULL model (E+T, k, deg(new)^2):  R^2=${full.r2.toFixed(4)}   coeffs(intercept, E+T, k, deg^2)=[${full.coeffs.map((c) => c.toFixed(5)).join(", ")}]`
  );
  console.log(
    `  only k:                            R^2=${onlyK.r2.toFixed(4)}`
  );
  console.log(
    `  only deg(new)^2:                   R^2=${onlyDegSq.r2.toFixed(4)}`
  );
  console.log(
    `  only (E+T):                        R^2=${onlyEplusT.r2.toFixed(4)}`
  );
}

console.log(
  "\nInterpretation: if the FULL model's R^2 is meaningfully higher than every single-term model, that " +
    "supports the claimed 3-term formula over any single-term simplification. Coefficients close to 0 for " +
    "a term suggest that term is not empirically load-bearing in the regime tested, regardless of its " +
    "asymptotic correctness."
);

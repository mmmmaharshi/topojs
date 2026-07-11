/**
 * Real-data speed benchmark: IncrementalH1 (v3) vs. Phase A naive recompute
 * (StreamingHomology). ONE harness, parameterized by dataset -- this file
 * replaces three earlier near-duplicate scripts
 * (incremental-real-data-benchmark.ts, incremental-iris-benchmark.ts,
 * incremental-melbourne-temp-benchmark.ts), which shared ~90% of their code
 * and differed only in data loading + a few numeric params.
 *
 * POLICY: every dataset registered here MUST be real, externally-sourced
 * data (see each entry's `source` field) -- no i.i.d. random / synthetic
 * point clouds. When adding a new benchmark axis (new dataset, new engine,
 * new algorithm variant), extend the DATASETS registry below rather than
 * writing a new standalone script.
 *
 * Two trial designs, chosen per dataset:
 *   - "chunks": for long real time series (sunspots, Melbourne temps) --
 *     split the single real series into disjoint contiguous chunks, each
 *     chunk = one independent paired trial (naive vs incremental, same
 *     data). Standard practice when only one long real series is available.
 *   - "repeats": for small fixed datasets (Iris, 150 points total) -- there
 *     is only one real ordering, so "trials" are repeated timed runs of the
 *     SAME stream. This measures measurement/JIT noise, not data diversity
 *     -- stated honestly in the per-dataset note, not dressed up.
 *
 * Run all real-data benchmarks:  npm run bench
 * Run just one:                 npm run bench -- sunspots
 * List available datasets:      npm run bench -- --list
 * Scaling sweep (see below):    npm run bench -- --scaling melbourne-temp
 * Memory sweep (see below):     npm run bench -- --memory melbourne-temp
 * Regime sweep (see below):     npm run bench -- --regime
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { StreamingHomology } from '../src/streaming/streaming-homology.ts';
import { IncrementalH1 } from '../src/streaming/incremental-h1.ts';
import { loadIrisDataset } from '../src/data/realworld-datasets.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── shared helpers ──────────────────────────────────────────────────────

function autocorrelation(series: number[], lag: number): number {
  const n = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) den += (series[i]! - mean) ** 2;
  for (let i = 0; i + lag < n; i++) num += (series[i]! - mean) * (series[i + lag]! - mean);
  return num / den;
}

/** First lag where autocorrelation drops below 1/e (not hand-tuned per dataset). */
function dataDrivenLag(series: number[], maxScan: number, fallback: number): number {
  const threshold = 1 / Math.E;
  let lag = 1;
  for (let l = 1; l <= maxScan; l++) {
    const acf = autocorrelation(series, l);
    if (acf < threshold && lag === 1 && l > 1) lag = l;
  }
  return lag === 1 ? fallback : lag;
}

function minMax(series: number[]): [number, number] {
  return [Math.min(...series), Math.max(...series)];
}

function delayEmbed2D(series: number[], lag: number): number[][] {
  const [min, max] = minMax(series);
  const norm = (v: number) => (v - min) / (max - min);
  const pts: number[][] = [];
  for (let i = 0; i + lag < series.length; i++) pts.push([norm(series[i]!), norm(series[i + lag]!)]);
  return pts;
}

function loadCsvColumn(filename: string, valueRegex: RegExp): number[] {
  const csvPath = join(__dirname, 'data', filename);
  const raw = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
  return raw.map((line) => {
    const m = line.match(valueRegex);
    if (!m) throw new Error(`unparseable row in ${filename}: ${line}`);
    return Number(m[1]);
  });
}

function benchNaive(points: number[][], dims: number, windowSize: number, maxDist: number, warmup: number, timedSteps: number): number {
  const s = new StreamingHomology({ windowSize, dims, maxDist, maxDim: 2 });
  for (let i = 0; i < warmup; i++) s.push(points[i]!);
  const start = performance.now();
  for (let i = warmup; i < warmup + timedSteps; i++) s.push(points[i]!);
  return performance.now() - start;
}

function benchIncremental(
  points: number[][], dims: number, windowSize: number, maxDist: number, warmup: number, timedSteps: number,
): { ms: number; reReducedFrac: number } {
  const s = new IncrementalH1({ windowSize, dims, maxDist });
  for (let i = 0; i < warmup; i++) s.push(points[i]!);
  let totalReReduced = 0;
  let totalTriangles = 0;
  const start = performance.now();
  for (let i = warmup; i < warmup + timedSteps; i++) {
    const u = s.push(points[i]!)!;
    totalReReduced += u.stats.reReducedTriangles;
    totalTriangles += u.stats.totalTriangles;
  }
  const ms = performance.now() - start;
  return { ms, reReducedFrac: totalTriangles > 0 ? totalReReduced / totalTriangles : 0 };
}

/** Same as benchNaive, but also reports the realized complex size from the LAST
 * timed push (steady-state density for this windowSize/maxDist combo). */
function benchNaiveWithDensity(
  points: number[][], dims: number, windowSize: number, maxDist: number, warmup: number, timedSteps: number,
): { ms: number; numEdges: number; numTriangles: number } {
  const s = new StreamingHomology({ windowSize, dims, maxDist, maxDim: 2 });
  for (let i = 0; i < warmup; i++) s.push(points[i]!);
  let numEdges = 0;
  let numTriangles = 0;
  const start = performance.now();
  for (let i = warmup; i < warmup + timedSteps; i++) {
    const u = s.push(points[i]!)!;
    numEdges = u.result.complex.numEdges;
    numTriangles = u.result.complex.numTriangles;
  }
  const ms = performance.now() - start;
  return { ms, numEdges, numTriangles };
}

/**
 * Inverse standard normal CDF (Acklam's algorithm, ~1e-9 relative error).
 * Used only as the seed value for tQuantile()'s Cornish-Fisher expansion.
 */
function normInv(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pLow = 0.02425;
  if (p <= 0 || p >= 1) throw new RangeError('normInv: p must be in (0,1)');
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

/**
 * Two-sided Student's-t quantile for arbitrary cumulative probability p and
 * degrees of freedom df (Cornish-Fisher expansion around the normal
 * quantile -- Fisher & Cornish 1960, standard for this accuracy/complexity
 * tradeoff). General-purpose replacement for the fixed T_TABLE_975 lookup
 * below, needed because Bonferroni-correcting across multiple benchmark
 * axes requires a critical value at alpha/m, not just alpha=0.05.
 */
function tQuantile(p: number, df: number): number {
  const z = normInv(p);
  const z2 = z * z, z3 = z2 * z, z5 = z3 * z2, z7 = z5 * z2, z9 = z7 * z2;
  const g1 = (z3 + z) / 4;
  const g2 = (5 * z5 + 16 * z3 + 3 * z) / 96;
  const g3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / 384;
  const g4 = (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / 92160;
  return z + g1 / df + g2 / (df * df) + g3 / (df * df * df) + g4 / (df * df * df * df);
}

// Two-sided 97.5th-percentile t critical values, df=1..30 (Student's t table).
// Using the fixed z=1.96 (normal-approximation) critical value here was wrong
// for the small chunk counts (n=6-10, df=5-9) this benchmark actually uses --
// it understates the CI width at low df (e.g. true df=5 critical value is
// 2.571, not 1.96), making "95% CI" narrower than it actually is. df>30 falls
// back to the normal approximation, where the two are indistinguishable to
// 3 decimal places anyway.
const T_TABLE_975: number[] = [
  0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
];
function tCritical95(df: number): number {
  const d = Math.max(1, Math.round(df));
  return d <= 30 ? T_TABLE_975[d]! : 1.96;
}

/**
 * Chunks split from ONE real time series are not necessarily independent
 * trials -- residual autocorrelation can survive chunking (e.g. a run of
 * unusually dense/sparse months landing in adjacent chunks). This computes
 * lag-1 sample autocorrelation of the per-chunk log-speedups themselves (in
 * their original temporal order) as a direct empirical check, rather than
 * just assuming independence because the chunks are "disjoint".
 */
function lag1Autocorr(x: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const mean = x.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) den += (x[i]! - mean) ** 2;
  for (let i = 0; i < n - 1; i++) num += (x[i]! - mean) * (x[i + 1]! - mean);
  return den === 0 ? 0 : num / den;
}

function pairedStats(logSpeedups: number[]) {
  const n = logSpeedups.length;
  const mean = logSpeedups.reduce((a, b) => a + b, 0) / n;
  const variance = logSpeedups.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance) / Math.sqrt(n);
  const tCrit = tCritical95(n - 1);

  // Autocorrelation-adjusted view: if chunks carry residual AR(1)-like
  // correlation (chunkAutocorr), the "effective" number of independent
  // observations is smaller than n (Zwiers & von Storch 1995 effective-N
  // correction: n_eff = n * (1-r)/(1+r)). Reported alongside the raw stats,
  // not silently substituted for them, so a reader who trusts the raw n=6-10
  // t-test can still see it, but is also told how much of that significance
  // survives once residual correlation between chunks is accounted for.
  const chunkAutocorr = lag1Autocorr(logSpeedups);
  const rClamped = Math.max(-0.95, Math.min(0.95, chunkAutocorr));
  const nEffRaw = (n * (1 - rClamped)) / (1 + rClamped);
  const nEff = Math.max(2, Math.min(n, nEffRaw));
  const seEff = Math.sqrt(variance) / Math.sqrt(nEff);
  const tCritEff = tCritical95(nEff - 1);

  return {
    n,
    mean,
    se,
    tStat: mean / se,
    geoMean: Math.exp(mean),
    ciLow: Math.exp(mean - tCrit * se),
    ciHigh: Math.exp(mean + tCrit * se),
    chunkAutocorr,
    nEff,
    tStatEff: mean / seEff,
    ciLowEff: Math.exp(mean - tCritEff * seEff),
    ciHighEff: Math.exp(mean + tCritEff * seEff),
  };
}

// ── dataset registry ────────────────────────────────────────────────────

interface DatasetConfig {
  name: string;
  source: string;
  mode: 'chunks' | 'repeats';
  dims: number;
  windowSize: number;
  maxDist: number;
  nTrials: number; // chunks or repeats
  note?: string;
  /** Window sizes used by --scaling to empirically measure growth rate on this dataset's real data. */
  scalingWindowSizes: number[];
  /** Trials per window size for --scaling; smaller for datasets too short to support the default. */
  scalingTrials?: number;
  /** Window sizes used by --regime to map density -> speedup on this dataset's real data. */
  regimeWindowSizes: number[];
  /** maxDist values swept by --regime (dataset-appropriate range, normalized [0,1] space). */
  regimeMaxDists: number[];
  /** Returns the full real point stream in original order, plus a log line describing it. */
  load(): { points: number[][]; logLines: string[] };
}

const DATASETS: Record<string, DatasetConfig> = {
  sunspots: {
    name: 'Monthly sunspot counts (1749-1983)',
    source: 'SIDC/WDC-SILSO, bench/data/monthly-sunspots.csv',
    mode: 'chunks',
    dims: 2,
    windowSize: 40,
    maxDist: 0.15,
    nTrials: 6,
    scalingWindowSizes: [10, 20, 40, 80],
    regimeWindowSizes: [40, 80],
    regimeMaxDists: [0.05, 0.08, 0.10, 0.13, 0.15, 0.18, 0.22],
    load: loadSunspots,
  },
  iris: {
    name: 'UCI Iris measurements (150 samples)',
    source: 'archive.ics.uci.edu, embedded in src/data/realworld-datasets.ts',
    mode: 'repeats',
    dims: 4,
    windowSize: 20,
    maxDist: 0.35,
    nTrials: 10,
    note: 'Only 150 real points exist; repeats time the SAME stream (measurement/JIT noise, not data diversity).',
    scalingWindowSizes: [5, 10, 20],
    scalingTrials: 3,
    regimeWindowSizes: [20],
    regimeMaxDists: [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45],
    load: loadIris,
  },
  'melbourne-temp': {
    name: 'Melbourne daily min. temperatures (1981-1990)',
    source: 'Australian BOM, bench/data/daily-min-temperatures.csv',
    mode: 'chunks',
    dims: 2,
    windowSize: 45,
    maxDist: 0.15,
    nTrials: 8,
    scalingWindowSizes: [10, 20, 40, 80],
    regimeWindowSizes: [40, 80],
    regimeMaxDists: [0.05, 0.08, 0.10, 0.13, 0.15, 0.18, 0.22],
    load: loadMelbourneTemp,
  },
};

// -- dataset loaders (each returns REAL data only, no synthesis) --

function loadSunspots(): { points: number[][]; logLines: string[] } {
  const monthly = loadCsvColumn('monthly-sunspots.csv', /^"\d{4}-\d{2}",([\d.]+)/);
  const lag = dataDrivenLag(monthly, 40, 6);
  const points = delayEmbed2D(monthly, lag);
  return {
    points,
    logLines: [
      `Loaded ${monthly.length} REAL monthly sunspot readings (SIDC/WDC-SILSO, 1749-1983).`,
      `Data-driven lag (first ACF < 1/e, scanned 1..40 months): LAG=${lag}`,
      `Embedded stream length: ${points.length} points (2D delay embedding, lag=${lag} months).`,
    ],
  };
}

function loadMelbourneTemp(): { points: number[][]; logLines: string[] } {
  const daily = loadCsvColumn('daily-min-temperatures.csv', /^"[\d-]+",([\d.]+)/);
  const lag = dataDrivenLag(daily, 60, 10);
  const points = delayEmbed2D(daily, lag);
  return {
    points,
    logLines: [
      `Loaded ${daily.length} REAL daily minimum temperatures (Melbourne, Australia BOM, 1981-1990).`,
      `Data-driven lag (first ACF < 1/e, scanned 1..60 days): LAG=${lag}`,
      `Embedded stream length: ${points.length} points (2D delay embedding, lag=${lag} days).`,
    ],
  };
}

function loadIris(): { points: number[][]; logLines: string[] } {
  const DIMS = 4;
  const flat = loadIrisDataset(); // 150 * 4, real UCI data, original order (by species)
  const n = flat.length / DIMS;
  const colMin = new Float64Array(DIMS).fill(Infinity);
  const colMax = new Float64Array(DIMS).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < DIMS; d++) {
      const v = flat[i * DIMS + d]!;
      if (v < colMin[d]!) colMin[d] = v;
      if (v > colMax[d]!) colMax[d] = v;
    }
  }
  const points: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p: number[] = [];
    for (let d = 0; d < DIMS; d++) p.push((flat[i * DIMS + d]! - colMin[d]!) / (colMax[d]! - colMin[d]!));
    points.push(p);
  }
  return {
    points,
    logLines: [`Loaded ${n} REAL Iris measurements (UCI, original order: 50 Setosa, 50 Versicolor, 50 Virginica).`],
  };
}

// ── runner ───────────────────────────────────────────────────────────────

function runDataset(key: string): {
  key: string; geoMean: number; ciLow: number; ciHigh: number;
  nEff: number; ciLowEff: number; ciHighEff: number; n: number; mean: number; se: number;
} {
  const cfg = DATASETS[key];
  if (!cfg) throw new Error(`unknown dataset "${key}". Known: ${Object.keys(DATASETS).join(', ')}`);

  console.log(`\n=== ${cfg.name} ===`);
  console.log(`source: ${cfg.source}`);
  if (cfg.note) console.log(`note: ${cfg.note}`);

  const { points, logLines } = cfg.load();
  for (const l of logLines) console.log(l);

  const warmup = cfg.windowSize + 5;
  console.log(`windowSize=${cfg.windowSize}  maxDist=${cfg.maxDist}  mode=${cfg.mode}  trials=${cfg.nTrials}`);

  const logSpeedups: number[] = [];
  const reReducedFracs: number[] = [];

  console.log('trial'.padStart(8) + 'naive_ms'.padStart(12) + 'incr_ms'.padStart(12) + 'speedup'.padStart(10) + 'reReduced%'.padStart(12));

  if (cfg.mode === 'chunks') {
    const chunkLen = Math.floor(points.length / cfg.nTrials);
    const timedSteps = Math.min(150, chunkLen - warmup - 5);
    for (let c = 0; c < cfg.nTrials; c++) {
      const chunk = points.slice(c * chunkLen, c * chunkLen + chunkLen);
      const naiveMs = benchNaive(chunk, cfg.dims, cfg.windowSize, cfg.maxDist, warmup, timedSteps);
      const { ms: incrMs, reReducedFrac } = benchIncremental(chunk, cfg.dims, cfg.windowSize, cfg.maxDist, warmup, timedSteps);
      const speedup = naiveMs / incrMs;
      logSpeedups.push(Math.log(speedup));
      reReducedFracs.push(reReducedFrac);
      console.log(
        String(c).padStart(8) + naiveMs.toFixed(2).padStart(12) + incrMs.toFixed(2).padStart(12) +
          `${speedup.toFixed(3)}x`.padStart(10) + `${(reReducedFrac * 100).toFixed(1)}%`.padStart(12),
      );
    }
  } else {
    const timedSteps = points.length - warmup - 1;
    for (let r = 0; r < cfg.nTrials; r++) {
      const naiveMs = benchNaive(points, cfg.dims, cfg.windowSize, cfg.maxDist, warmup, timedSteps);
      const { ms: incrMs, reReducedFrac } = benchIncremental(points, cfg.dims, cfg.windowSize, cfg.maxDist, warmup, timedSteps);
      const speedup = naiveMs / incrMs;
      logSpeedups.push(Math.log(speedup));
      reReducedFracs.push(reReducedFrac);
      console.log(
        String(r).padStart(8) + naiveMs.toFixed(3).padStart(12) + incrMs.toFixed(3).padStart(12) +
          `${speedup.toFixed(3)}x`.padStart(10) + `${(reReducedFrac * 100).toFixed(1)}%`.padStart(12),
      );
    }
  }

  const stats = pairedStats(logSpeedups);
  const { n, mean, se, tStat, geoMean, ciLow, ciHigh, chunkAutocorr, nEff, tStatEff, ciLowEff, ciHighEff } = stats;
  const meanReReduced = reReducedFracs.reduce((a, b) => a + b, 0) / reReducedFracs.length;

  console.log(`geometric mean speedup: ${geoMean.toFixed(3)}x  (95% CI: ${ciLow.toFixed(3)}x .. ${ciHigh.toFixed(3)}x)`);
  console.log(`mean re-reduced fraction: ${(meanReReduced * 100).toFixed(1)}%`);
  console.log(`paired t-test on log(speedup), H0: speedup=1x, H1: speedup>1x, df=${n - 1}: t=${tStat.toFixed(3)}`);
  if (cfg.mode === 'repeats') {
    // 'repeats' trials are re-timings of the IDENTICAL stream (see dataset
    // note above): this t-test's null hypothesis is only "the mean of
    // repeated timings of this one specific run equals 1x", i.e. it
    // confirms the measurement is reliable/repeatable, NOT that the
    // speedup generalizes beyond this exact dataset/ordering/config (that
    // would require independent data, which doesn't exist here -- see
    // CROSS-DATASET GENERALIZATION note). Printed explicitly so the t-stat
    // above isn't read as stronger evidence than it is.
    console.log(
      'CAVEAT: mode=repeats -- above t-test/CI measure repeatability of one ' +
        'fixed stream\'s timing, not generalization to other real data (n=' +
        n + ' timed re-runs of the SAME 150-point ordering, not independent trials).',
    );
  }
  if (cfg.mode === 'chunks') {
    // Chunks are disjoint slices of ONE real series, not independent draws --
    // report the residual correlation between them directly instead of just
    // assuming n=chunk-count independent trials (see pairedStats docstring).
    const flag = Math.abs(chunkAutocorr) > 0.3 ? '  [non-trivial -- see effective-N line]' : '  [low]';
    console.log(`chunk-order lag-1 autocorrelation of log(speedup): ${chunkAutocorr.toFixed(3)}${flag}`);
    console.log(
      `effective-N adjusted: n_eff=${nEff.toFixed(2)} (of ${n} raw), t=${tStatEff.toFixed(3)}, ` +
        `95% CI: ${ciLowEff.toFixed(3)}x .. ${ciHighEff.toFixed(3)}x`,
    );
  }

  return { key, geoMean, ciLow, ciHigh, nEff, ciLowEff, ciHighEff, n, mean, se };
}

// ── scaling sweep ────────────────────────────────────────────────────────
// Empirically validates the complexity claim (naive O(k^2)/O(k^3) full
// rebuild vs incremental O(k) + O(deg(new)^2) update) by measuring both
// engines across a RANGE of window sizes on the SAME real dataset, then
// fitting a log-log growth-rate exponent (time ~ C * windowSize^p) to each.
// Real windowed data is not a complete graph, so measured exponents will
// not exactly hit the worst-case bound -- this reports actual growth on
// real data, not the theoretical bound, and says so in the output.

interface ScalingRow {
  windowSize: number;
  naiveMs: number;
  incrMs: number;
  speedup: number;
  reReducedFrac: number;
}

function logLogSlope(xs: number[], ys: number[]): number {
  const lx = xs.map(Math.log);
  const ly = ys.map(Math.log);
  const n = lx.length;
  const mx = lx.reduce((a, b) => a + b, 0) / n;
  const my = ly.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (lx[i]! - mx) * (ly[i]! - my);
    den += (lx[i]! - mx) ** 2;
  }
  return num / den;
}

function runScalingSweep(key: string, windowSizes: number[], trialsPerSize = 10): void {
  const cfg = DATASETS[key];
  if (!cfg) throw new Error(`unknown dataset "${key}". Known: ${Object.keys(DATASETS).join(', ')}`);

  console.log(`\n=== SCALING SWEEP: ${cfg.name} ===`);
  console.log(`source: ${cfg.source}`);
  console.log('(measures real growth rate vs. window size -- validates the O(k) vs O(k^2)/O(k^3) claim on real data)');

  const { points, logLines } = cfg.load();
  for (const l of logLines) console.log(l);

  const rows: ScalingRow[] = [];
  console.log();
  console.log('windowSize'.padStart(10) + 'naive_ms'.padStart(12) + 'incr_ms'.padStart(12) + 'speedup'.padStart(10) + 'reReduced%'.padStart(12));

  for (const windowSize of windowSizes) {
    const warmup = windowSize + 5;
    const chunkLen = Math.floor(points.length / trialsPerSize);
    if (chunkLen < warmup + 25) {
      console.log(`${String(windowSize).padStart(10)}  skipped -- not enough real data for ${trialsPerSize} trials at this window size`);
      continue;
    }
    // Fewer timed pushes at larger window sizes (each push costs more) so total
    // sweep time stays roughly bounded across the range, not just the timed part --
    // the untimed warmup fill (O(windowSize) pushes) still scales with window size.
    const timedSteps = Math.min(60, Math.max(25, Math.floor(2000 / windowSize)), chunkLen - warmup - 5);

    let naiveTotal = 0;
    let incrTotal = 0;
    let reReducedTotal = 0;
    for (let t = 0; t < trialsPerSize; t++) {
      const chunk = points.slice(t * chunkLen, t * chunkLen + chunkLen);
      naiveTotal += benchNaive(chunk, cfg.dims, windowSize, cfg.maxDist, warmup, timedSteps);
      const { ms, reReducedFrac } = benchIncremental(chunk, cfg.dims, windowSize, cfg.maxDist, warmup, timedSteps);
      incrTotal += ms;
      reReducedTotal += reReducedFrac;
    }
    const naiveMs = naiveTotal / trialsPerSize;
    const incrMs = incrTotal / trialsPerSize;
    const row: ScalingRow = { windowSize, naiveMs, incrMs, speedup: naiveMs / incrMs, reReducedFrac: reReducedTotal / trialsPerSize };
    rows.push(row);
    console.log(
      String(windowSize).padStart(10) + naiveMs.toFixed(2).padStart(12) + incrMs.toFixed(2).padStart(12) +
        `${row.speedup.toFixed(2)}x`.padStart(10) + `${(row.reReducedFrac * 100).toFixed(1)}%`.padStart(12),
    );
  }

  if (rows.length < 3) {
    console.log('\nNot enough completed window sizes for a growth-rate fit (need >=3).');
    return;
  }

  const naiveSlope = logLogSlope(rows.map((r) => r.windowSize), rows.map((r) => r.naiveMs));
  const incrSlope = logLogSlope(rows.map((r) => r.windowSize), rows.map((r) => r.incrMs));
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;

  console.log();
  console.log('empirical growth rate on real data (log-log slope, time ~ windowSize^p):');
  console.log(`  naive (Phase A, full rebuild):     p=${naiveSlope.toFixed(2)}`);
  console.log(`  incremental (v3 IncrementalH1):    p=${incrSlope.toFixed(2)}`);
  console.log(`speedup grows with window size: ${first.speedup.toFixed(2)}x at windowSize=${first.windowSize} -> ${last.speedup.toFixed(2)}x at windowSize=${last.windowSize}`);
  console.log('NOTE: real windowed point clouds are not complete graphs, so these exponents will not exactly');
  console.log('match the worst-case O(k^2)/O(k^3) bound -- this measures actual growth on real data, not the bound.');
  console.log('A widening speedup with window size (not a flat ratio) is the signal that the algorithmic change,');
  console.log('not a constant-factor optimization, is what is being measured.');
}

// ── memory sweep ─────────────────────────────────────────────────────────
// Everything above measures TIME only. This measures SPACE: heap used by a
// fully-warmed-up engine instance holding one window's worth of state, for
// both engines, across a range of real window sizes.
//
// Caveat stated up front: process.memoryUsage().heapUsed is inherently
// noisy (V8 heap growth in chunks, GC timing, JIT-compiled code taking
// space too) -- this is NOT a precise byte-accounting of either engine's
// data structures. It is run with --expose-gc (see package.json's "bench"
// script) so a manual global.gc() can be forced immediately before each
// measurement, which reduces but does not eliminate the noise. Treat
// these as order-of-magnitude comparisons, not exact figures -- and this
// script says so in its own output, not just here.

function forceGc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g === 'function') g();
}

function measureHeapMBOnce(build: () => unknown): number {
  forceGc();
  const before = process.memoryUsage().heapUsed;
  const handle = build();
  forceGc();
  const after = process.memoryUsage().heapUsed;
  // Keep a reference alive until after the second measurement so V8 can't
  // collect it early and understate the delta.
  void handle;
  return (after - before) / (1024 * 1024);
}

/**
 * Single heap-delta samples are noisy (GC timing, V8 heap chunking) even
 * with forced GC -- median of several repeated builds is far more stable
 * than any one sample. Discards fresh-instance construction cost variance
 * by rebuilding from scratch each repeat (matches how these engines are
 * actually used -- one instance per window, not reused across windows).
 */
function measureHeapMBMedian(build: () => unknown, repeats = 7): number {
  const samples = Array.from({ length: repeats }, () => measureHeapMBOnce(build));
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

function runMemorySweep(key: string, windowSizes: number[]): void {
  const cfg = DATASETS[key];
  if (!cfg) throw new Error(`unknown dataset "${key}". Known: ${Object.keys(DATASETS).join(', ')}`);

  const hasGc = typeof (globalThis as { gc?: () => void }).gc === 'function';
  console.log(`\n=== MEMORY SWEEP: ${cfg.name} ===`);
  console.log(`source: ${cfg.source}`);
  console.log(`(process.memoryUsage().heapUsed deltas, median of 7 fresh builds per point -- noisy by nature even with GC forced, especially at small window sizes where the delta is a few hundred KB; ${hasGc ? 'manual GC forced before/after each build via --expose-gc' : 'NO --expose-gc detected, run via `npm run bench` for a manual-GC measurement -- these numbers will be substantially noisier without it'})`);

  const { points, logLines } = cfg.load();
  for (const l of logLines) console.log(l);

  console.log();
  console.log('windowSize'.padStart(10) + 'naive_MB'.padStart(12) + 'incr_MB'.padStart(12) + 'ratio(incr/naive)'.padStart(20));

  for (const windowSize of windowSizes) {
    const warmup = windowSize + 5;
    if (points.length < warmup) {
      console.log(`${String(windowSize).padStart(10)}  skipped -- not enough real data to fill this window`);
      continue;
    }
    const naiveMB = measureHeapMBMedian(() => {
      const s = new StreamingHomology({ windowSize, dims: cfg.dims, maxDist: cfg.maxDist, maxDim: 2 });
      for (let i = 0; i < warmup; i++) s.push(points[i]!);
      return s;
    });
    const incrMB = measureHeapMBMedian(() => {
      const s = new IncrementalH1({ windowSize, dims: cfg.dims, maxDist: cfg.maxDist });
      for (let i = 0; i < warmup; i++) s.push(points[i]!);
      return s;
    });
    const ratio = naiveMB > 0 ? incrMB / naiveMB : NaN;
    console.log(
      String(windowSize).padStart(10) + naiveMB.toFixed(3).padStart(12) + incrMB.toFixed(3).padStart(12) +
        (Number.isFinite(ratio) ? ratio.toFixed(2) : 'n/a').padStart(20),
    );
  }
  console.log();
  console.log('IncrementalH1 is expected to use MORE memory than StreamingHomology at a given window size:');
  console.log('it keeps the previous push\'s full edge/triangle lists AND reduced-column state alive between');
  console.log('pushes (to diff against), plus the neighborsOf adjacency map -- StreamingHomology holds none of');
  console.log('that, it only keeps the raw window contents and discards all derived state after each push.');
  console.log('This is the space side of the time/space trade-off the class docstring does not currently discuss.');
}

// ── regime sweep ─────────────────────────────────────────────────────────
// README.md's "Complexity, measured not just claimed" section established
// that the v3 speedup is CONDITIONAL on complex sparsity (E=o(k^2) or
// T=o(k^3)), not unconditional
// -- and that a naive "sparser dataset -> cleaner win" guess was checked
// against real density measurements and found FALSE. This sweep replaces
// that guess with a direct, measured map: for a range of REAL maxDist
// values (density lever) at fixed window sizes, record realized triangle
// density (T as % of the dense-complex max) alongside the measured
// speedup, across all three real datasets. The goal is a predictive rule
// ("v3 is worth it below X% density") backed by data, not a proof.

interface RegimeRow {
  dataset: string;
  windowSize: number;
  maxDist: number;
  triDensityPct: number;
  speedup: number;
}

function runRegimeSweep(keys: string[], windowSizeFilter?: number): RegimeRow[] {
  const allRows: RegimeRow[] = [];
  const trialsPerPoint = 3;

  for (const key of keys) {
    const cfg = DATASETS[key];
    if (!cfg) throw new Error(`unknown dataset "${key}". Known: ${Object.keys(DATASETS).join(', ')}`);
    console.log(`\n=== REGIME SWEEP: ${cfg.name} ===`);
    const { points } = cfg.load();

    const windowSizes = windowSizeFilter != null
      ? cfg.regimeWindowSizes.filter((w) => w === windowSizeFilter)
      : cfg.regimeWindowSizes;

    for (const windowSize of windowSizes) {
      const warmup = windowSize + 5;
      const chunkLen = Math.floor(points.length / trialsPerPoint);
      if (chunkLen < warmup + 20) {
        console.log(`  windowSize=${windowSize}: skipped -- not enough real data`);
        continue;
      }
      const timedSteps = Math.min(40, chunkLen - warmup - 5);
      const maxT = (windowSize * (windowSize - 1) * (windowSize - 2)) / 6;

      console.log(`  windowSize=${windowSize}:`);
      console.log('    maxDist'.padStart(11) + 'triDensity%'.padStart(14) + 'speedup'.padStart(10));

      for (const maxDist of cfg.regimeMaxDists) {
        let naiveTotal = 0;
        let incrTotal = 0;
        let triSum = 0;
        for (let t = 0; t < trialsPerPoint; t++) {
          const chunk = points.slice(t * chunkLen, t * chunkLen + chunkLen);
          const { ms: naiveMs, numTriangles } = benchNaiveWithDensity(chunk, cfg.dims, windowSize, maxDist, warmup, timedSteps);
          naiveTotal += naiveMs;
          triSum += numTriangles;
          incrTotal += benchIncremental(chunk, cfg.dims, windowSize, maxDist, warmup, timedSteps).ms;
        }
        const naiveMs = naiveTotal / trialsPerPoint;
        const incrMs = incrTotal / trialsPerPoint;
        const triDensityPct = (100 * (triSum / trialsPerPoint)) / maxT;
        const speedup = naiveMs / incrMs;
        allRows.push({ dataset: key, windowSize, maxDist, triDensityPct, speedup });
        console.log(
          `    ${maxDist.toFixed(2)}`.padStart(11) + `${triDensityPct.toFixed(2)}%`.padStart(14) + `${speedup.toFixed(2)}x`.padStart(10),
        );
      }
    }
  }
  return allRows;
}

function summarizeRegime(rows: RegimeRow[]): void {
  if (rows.length === 0) return;
  const sorted = [...rows].sort((a, b) => a.triDensityPct - b.triDensityPct);

  console.log('\n=== REGIME MAP: density -> speedup, all datasets combined ===');
  console.log('triDensity%'.padStart(14) + 'speedup'.padStart(10) + '  dataset(windowSize, maxDist)');
  for (const r of sorted) {
    console.log(`${r.triDensityPct.toFixed(2)}%`.padStart(14) + `${r.speedup.toFixed(2)}x`.padStart(10) + `  ${r.dataset}(k=${r.windowSize}, maxDist=${r.maxDist})`);
  }

  // Find the breakeven: the lowest density at which speedup dropped below 1x,
  // and the highest density at which speedup was still above 1x -- brackets
  // the crossover rather than claiming a single precise threshold.
  const below1 = sorted.filter((r) => r.speedup < 1);
  const above1 = sorted.filter((r) => r.speedup >= 1);
  console.log();
  if (below1.length === 0) {
    console.log('speedup stayed >= 1x across the ENTIRE density range swept -- no breakeven observed in this sweep.');
  } else if (above1.length === 0) {
    console.log('speedup stayed < 1x across the ENTIRE density range swept -- v3 never won in this sweep.');
  } else {
    const lowestFailure = Math.min(...below1.map((r) => r.triDensityPct));
    const highestSuccess = Math.max(...above1.map((r) => r.triDensityPct));
    console.log(`lowest density where speedup < 1x: ${lowestFailure.toFixed(2)}%`);
    console.log(`highest density where speedup >= 1x: ${highestSuccess.toFixed(2)}%`);
    if (highestSuccess >= lowestFailure) {
      console.log(`NOTE: these overlap (${highestSuccess.toFixed(2)}% >= ${lowestFailure.toFixed(2)}%) -- density alone does`);
      console.log('NOT cleanly predict speedup in this sweep; other factors (dataset, window size, noise) matter too.');
      console.log('Reported honestly rather than forcing a single clean threshold that the data does not support.');
    } else {
      console.log(`breakeven brackets to roughly ${highestSuccess.toFixed(2)}%-${lowestFailure.toFixed(2)}% triangle density.`);
    }
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (arg === '--list') {
  console.log('Available datasets:');
  for (const [key, cfg] of Object.entries(DATASETS)) console.log(`  ${key.padEnd(16)} ${cfg.name}  (${cfg.source})`);
  process.exit(0);
}

if (arg === '--scaling') {
  const dsKey = process.argv[3] ?? 'melbourne-temp';
  const sizesArg = process.argv[4];
  const trialsArg = process.argv[5];
  const cfg = DATASETS[dsKey];
  if (!cfg) throw new Error(`unknown dataset "${dsKey}". Known: ${Object.keys(DATASETS).join(', ')}`);
  const windowSizes = sizesArg ? sizesArg.split(',').map(Number) : cfg.scalingWindowSizes;
  runScalingSweep(dsKey, windowSizes, trialsArg ? Number(trialsArg) : (cfg.scalingTrials ?? 10));
  process.exit(0);
}

if (arg === '--memory') {
  const dsKey = process.argv[3] ?? 'melbourne-temp';
  const sizesArg = process.argv[4];
  const cfg = DATASETS[dsKey];
  if (!cfg) throw new Error(`unknown dataset "${dsKey}". Known: ${Object.keys(DATASETS).join(', ')}`);
  const windowSizes = sizesArg ? sizesArg.split(',').map(Number) : cfg.scalingWindowSizes;
  runMemorySweep(dsKey, windowSizes);
  process.exit(0);
}

if (arg === '--regime') {
  const dsArg = process.argv[3];
  const windowSizeArg = process.argv[4];
  const keys = dsArg ? [dsArg] : Object.keys(DATASETS);
  const rows = runRegimeSweep(keys, windowSizeArg ? Number(windowSizeArg) : undefined);
  summarizeRegime(rows);
  process.exit(0);
}

const keysToRun = arg ? [arg] : Object.keys(DATASETS);
const results = keysToRun.map(runDataset);

if (results.length > 1) {
  console.log('\n=== summary (all datasets) ===');
  for (const r of results) {
    console.log(`${r.key.padEnd(16)} ${r.geoMean.toFixed(3)}x  (95% CI: ${r.ciLow.toFixed(3)}x .. ${r.ciHigh.toFixed(3)}x)`);
  }

  // Multiple-comparisons correction: presenting all m=results.length axes
  // together as a combined "speedup confirmed across independent real
  // datasets" claim is exactly the situation Bonferroni correction is for
  // (m simultaneous per-axis tests, family-wise error rate would exceed the
  // nominal 5% if left uncorrected). Each axis's per-axis 95% CI above is
  // still valid taken alone; this second CI is the one to use when citing
  // "all three significant" as a single combined claim.
  const m = results.length;
  console.log(`\nBonferroni-corrected across ${m} simultaneous axes (family-wise alpha=0.05, per-axis alpha=${(0.05 / m).toFixed(4)}):`);
  for (const r of results) {
    const df = r.n - 1;
    const tCritBonf = tQuantile(1 - 0.05 / m / 2, df);
    const ciLowBonf = Math.exp(r.mean - tCritBonf * r.se);
    const ciHighBonf = Math.exp(r.mean + tCritBonf * r.se);
    const survives = ciLowBonf > 1 ? 'still >1x' : 'NO LONGER excludes 1x';
    console.log(
      `${r.key.padEnd(16)} ${r.geoMean.toFixed(3)}x  (Bonferroni 95% CI: ${ciLowBonf.toFixed(3)}x .. ${ciHighBonf.toFixed(3)}x)  ${survives}`,
    );
  }
}

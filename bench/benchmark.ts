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

function pairedStats(logSpeedups: number[]) {
  const n = logSpeedups.length;
  const mean = logSpeedups.reduce((a, b) => a + b, 0) / n;
  const variance = logSpeedups.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance) / Math.sqrt(n);
  return {
    n,
    tStat: mean / se,
    geoMean: Math.exp(mean),
    ciLow: Math.exp(mean - 1.96 * se),
    ciHigh: Math.exp(mean + 1.96 * se),
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

function runDataset(key: string): { key: string; geoMean: number; ciLow: number; ciHigh: number } {
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

  const { n, tStat, geoMean, ciLow, ciHigh } = pairedStats(logSpeedups);
  const meanReReduced = reReducedFracs.reduce((a, b) => a + b, 0) / reReducedFracs.length;

  console.log(`geometric mean speedup: ${geoMean.toFixed(3)}x  (95% CI: ${ciLow.toFixed(3)}x .. ${ciHigh.toFixed(3)}x)`);
  console.log(`mean re-reduced fraction: ${(meanReReduced * 100).toFixed(1)}%`);
  console.log(`paired t-test on log(speedup), H0: speedup=1x, H1: speedup>1x, df=${n - 1}: t=${tStat.toFixed(3)}`);

  return { key, geoMean, ciLow, ciHigh };
}

// ── CLI ──────────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (arg === '--list') {
  console.log('Available datasets:');
  for (const [key, cfg] of Object.entries(DATASETS)) console.log(`  ${key.padEnd(16)} ${cfg.name}  (${cfg.source})`);
  process.exit(0);
}

const keysToRun = arg ? [arg] : Object.keys(DATASETS);
const results = keysToRun.map(runDataset);

if (results.length > 1) {
  console.log('\n=== summary (all datasets) ===');
  for (const r of results) {
    console.log(`${r.key.padEnd(16)} ${r.geoMean.toFixed(3)}x  (95% CI: ${r.ciLow.toFixed(3)}x .. ${r.ciHigh.toFixed(3)}x)`);
  }
}

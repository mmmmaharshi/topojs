/**
 * Real-data speed benchmark #3: IncrementalH1 (v3) vs. Phase A naive, on
 * Melbourne daily minimum temperatures, 1981-1990 (3650 real daily
 * readings, Australian Bureau of Meteorology, via the public mirror
 * bench/data/daily-min-temperatures.csv -- downloaded from
 * https://raw.githubusercontent.com/jbrownlee/Datasets/master/daily-min-temperatures.csv,
 * NOT synthesized or hand-typed).
 *
 * A third, distinct real-data regime from the other two real benchmarks in
 * this directory: bench/incremental-real-data-benchmark.ts uses monthly
 * sunspot counts (smooth ~11-year solar cycle, low sample rate), and
 * bench/incremental-iris-benchmark.ts uses 150 static biological
 * measurements with an abrupt species-block structure. This one is a much
 * longer (3650-point), noisier, dual-seasonality daily climate series
 * (yearly seasonal cycle plus real day-to-day weather noise) -- a stronger
 * test of whether the v3 incremental-geometry speedup generalizes.
 *
 * Method: same paired-chunk design as the sunspot benchmark. 2D delay
 * (Takens) embedding, lag selected via the same data-driven ACF<1/e rule
 * (not tuned to this result). Split into disjoint chunks (paired trials);
 * each chunk timed on both engines fresh.
 *
 * Run with: node --experimental-transform-types bench/incremental-melbourne-temp-benchmark.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { StreamingHomology } from '../src/streaming/streaming-homology.ts';
import { IncrementalH1 } from '../src/streaming/incremental-h1.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, 'data', 'daily-min-temperatures.csv');

// --- Load real data (no synthesis) ---
const raw = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
const daily: number[] = raw.map((line) => {
  const m = line.match(/^"[\d-]+",([\d.]+)/);
  if (!m) throw new Error(`unparseable row: ${line}`);
  return Number(m[1]);
});
console.log(`Loaded ${daily.length} REAL daily minimum temperatures (Melbourne, Australia BOM, 1981-1990).`);

// --- Data-driven lag selection (autocorrelation, first crossing below 1/e) ---
function autocorrelation(series: number[], lag: number): number {
  const n = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) den += (series[i]! - mean) ** 2;
  for (let i = 0; i + lag < n; i++) num += (series[i]! - mean) * (series[i + lag]! - mean);
  return num / den;
}
const ACF_THRESHOLD = 1 / Math.E;
let LAG = 1;
for (let lag = 1; lag <= 60; lag++) {
  const acf = autocorrelation(daily, lag);
  if (acf < ACF_THRESHOLD && LAG === 1 && lag > 1) LAG = lag;
}
if (LAG === 1) LAG = 10;
console.log(`Data-driven lag (first ACF < 1/e, scanned 1..60 days): LAG=${LAG}`);

const min = Math.min(...daily);
const max = Math.max(...daily);
const norm = (v: number) => (v - min) / (max - min);

function embed(series: number[]): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i + LAG < series.length; i++) pts.push([norm(series[i]!), norm(series[i + LAG]!)]);
  return pts;
}
const embedded = embed(daily);
console.log(`Embedded stream length: ${embedded.length} points (2D delay embedding, lag=${LAG} days).`);

const DIMS = 2;
const WINDOW_SIZE = 45;
const MAX_DIST = 0.15;
const N_CHUNKS = 8;
const CHUNK_LEN = Math.floor(embedded.length / N_CHUNKS);
const WARMUP = WINDOW_SIZE + 5;
const TIMED_STEPS = Math.min(150, CHUNK_LEN - WARMUP - 5);

console.log(`windowSize=${WINDOW_SIZE}  maxDist=${MAX_DIST}  chunks=${N_CHUNKS}  chunk_len=${CHUNK_LEN}  timed_steps/chunk=${TIMED_STEPS}`);

function benchNaive(points: number[][]): number {
  const s = new StreamingHomology({ windowSize: WINDOW_SIZE, dims: DIMS, maxDist: MAX_DIST, maxDim: 2 });
  for (let i = 0; i < WARMUP; i++) s.push(points[i]!);
  const start = performance.now();
  for (let i = WARMUP; i < WARMUP + TIMED_STEPS; i++) s.push(points[i]!);
  return performance.now() - start;
}

function benchIncremental(points: number[][]): { ms: number; reReducedFrac: number } {
  const s = new IncrementalH1({ windowSize: WINDOW_SIZE, dims: DIMS, maxDist: MAX_DIST });
  for (let i = 0; i < WARMUP; i++) s.push(points[i]!);
  let totalReReduced = 0;
  let totalTriangles = 0;
  const start = performance.now();
  for (let i = WARMUP; i < WARMUP + TIMED_STEPS; i++) {
    const u = s.push(points[i]!)!;
    totalReReduced += u.stats.reReducedTriangles;
    totalTriangles += u.stats.totalTriangles;
  }
  const ms = performance.now() - start;
  return { ms, reReducedFrac: totalTriangles > 0 ? totalReReduced / totalTriangles : 0 };
}

console.log();
console.log('trial(chunk)'.padStart(14) + 'naive_ms'.padStart(12) + 'incr_ms'.padStart(12) + 'speedup'.padStart(10) + 'reReduced%'.padStart(12));
const logSpeedups: number[] = [];
const reReducedFracs: number[] = [];
for (let c = 0; c < N_CHUNKS; c++) {
  const chunk = embedded.slice(c * CHUNK_LEN, c * CHUNK_LEN + CHUNK_LEN);
  const naiveMs = benchNaive(chunk);
  const { ms: incrMs, reReducedFrac } = benchIncremental(chunk);
  const speedup = naiveMs / incrMs;
  logSpeedups.push(Math.log(speedup));
  reReducedFracs.push(reReducedFrac);
  console.log(
    String(c).padStart(14) + naiveMs.toFixed(2).padStart(12) + incrMs.toFixed(2).padStart(12) +
      `${speedup.toFixed(3)}x`.padStart(10) + `${(reReducedFrac * 100).toFixed(1)}%`.padStart(12),
  );
}

const n = logSpeedups.length;
const mean = logSpeedups.reduce((a, b) => a + b, 0) / n;
const variance = logSpeedups.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
const se = Math.sqrt(variance) / Math.sqrt(n);
const tStat = mean / se;
const geoMean = Math.exp(mean);
const ciLow = Math.exp(mean - 1.96 * se);
const ciHigh = Math.exp(mean + 1.96 * se);
const meanReReduced = reReducedFracs.reduce((a, b) => a + b, 0) / reReducedFracs.length;

console.log();
console.log(`geometric mean speedup (REAL Melbourne temp data): ${geoMean.toFixed(3)}x  (95% CI: ${ciLow.toFixed(3)}x .. ${ciHigh.toFixed(3)}x)`);
console.log(`mean re-reduced fraction: ${(meanReReduced * 100).toFixed(1)}%`);
console.log(`paired t-test on log(speedup), H0: speedup=1x, H1: speedup>1x, df=${n - 1}: t=${tStat.toFixed(3)}`);
console.log(`(n=${n} chunks from one real series -- treat as indicative, not a large-sample claim)`);

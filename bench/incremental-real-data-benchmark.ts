/**
 * Real-data speed benchmark: IncrementalH1 (v3) vs. Phase A naive recompute
 * on an ACTUAL structured time series, not i.i.d. random points.
 *
 * Why this matters (see IncrementalH1 class docstring, v2 note): all prior
 * speedup numbers for this class were measured on i.i.d. uniform random
 * streams, which are close to a WORST case for the prefix-caching mechanism
 * -- a new random point easily forms an early-filtration edge, collapsing
 * the "safe prefix" almost every push, so the re-reduction-skipping part of
 * the algorithm rarely pays off there. Real streaming data (sensor logs,
 * time series) usually has temporal locality/autocorrelation, which should
 * let more of the filtration order stay stable push-to-push. This script
 * tests that directly instead of assuming it.
 *
 * Data: monthly sunspot counts, 1749-01 to 1983-12 (2820 months), the same
 * real observational series used in bench/real-data-validation.ts (SIDC/
 * WDC-SILSO, via the public mirror in bench/data/monthly-sunspots.csv) --
 * NOT synthetic. It has genuine, well-documented structure: the ~11-year
 * (~132-month) Schwabe solar cycle. We use MONTHLY resolution here (not the
 * yearly aggregate used in the correctness-validation script) specifically
 * to get enough streaming pushes for a timing benchmark while preserving
 * real short-lag autocorrelation.
 *
 * Method: 2D delay (Takens) embedding [x(t), x(t+lag)], lag selected from
 * the full series via the same data-driven rule as real-data-validation.ts
 * (first lag where autocorrelation drops below 1/e) -- not hand-tuned to
 * flatter this benchmark. The embedded stream is split into disjoint
 * contiguous chunks (each chunk = one "trial"); each chunk is fed through
 * both engines fresh, matching the paired-trial design used for the
 * synthetic proof-of-concept benchmarks. Splitting a single real series
 * into disjoint chunks (rather than needing many independent real datasets,
 * which don't exist) is standard practice for benchmarking on one long
 * real-world series -- each chunk still carries genuine local structure,
 * unlike a freshly-generated i.i.d. random stream.
 *
 * Run with: node --experimental-transform-types bench/incremental-real-data-benchmark.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { StreamingHomology } from '../src/streaming/streaming-homology.ts';
import { IncrementalH1 } from '../src/streaming/incremental-h1.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, 'data', 'monthly-sunspots.csv');

// --- Load real data (no synthesis, no shuffling) ---
const raw = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1);
const monthly: number[] = raw.map((line) => {
  const m = line.match(/^"(\d{4})-\d{2}",([\d.]+)/);
  if (!m) throw new Error(`unparseable row: ${line}`);
  return Number(m[2]);
});
console.log(`Loaded ${monthly.length} REAL monthly sunspot readings (SIDC/WDC-SILSO, 1749-1983).`);

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
for (let lag = 1; lag <= 40; lag++) {
  const acf = autocorrelation(monthly, lag);
  if (acf < ACF_THRESHOLD && LAG === 1 && lag > 1) LAG = lag;
}
if (LAG === 1) LAG = 6;
console.log(`Data-driven lag (first ACF < 1/e, scanned 1..40 months): LAG=${LAG}`);

const min = Math.min(...monthly);
const max = Math.max(...monthly);
const norm = (v: number) => (v - min) / (max - min);

function embed(series: number[]): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i + LAG < series.length; i++) pts.push([norm(series[i]!), norm(series[i + LAG]!)]);
  return pts;
}
const embedded = embed(monthly);
console.log(`Embedded stream length: ${embedded.length} points (2D delay embedding, lag=${LAG} months).`);

const DIMS = 2;
const WINDOW_SIZE = 40;
const MAX_DIST = 0.15;
const N_CHUNKS = 6;
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
console.log(`geometric mean speedup (REAL data): ${geoMean.toFixed(3)}x  (95% CI: ${ciLow.toFixed(3)}x .. ${ciHigh.toFixed(3)}x)`);
console.log(`mean re-reduced fraction on REAL data: ${(meanReReduced * 100).toFixed(1)}%`);
console.log(`paired t-test on log(speedup), H0: speedup=1x, H1: speedup>1x, df=${n - 1}: t=${tStat.toFixed(3)}`);
console.log(`(n=${n} chunks -- small N because there is only one real series to chunk; treat as indicative, not a large-sample claim)`);

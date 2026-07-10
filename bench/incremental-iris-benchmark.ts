/**
 * Real-data speed benchmark #2: IncrementalH1 (v3) vs. Phase A naive, on
 * the UCI Iris dataset -- a DIFFERENT kind of real data from the sunspot
 * time series in bench/incremental-real-data-benchmark.ts. Sunspots are a
 * real time series with temporal autocorrelation; Iris is 150 real
 * physical measurements (sepal/petal length+width, 4D) in their original
 * recording order: 50 Setosa, then 50 Versicolor, then 50 Virginica
 * (source: https://archive.ics.uci.edu/ml/datasets/iris, embedded verbatim
 * in src/data/realworld-datasets.ts). Streamed in that ORIGINAL order (not
 * shuffled), a sliding window crossing a species boundary sees a real,
 * abrupt structural change -- a genuinely different stress case from both
 * i.i.d. random data and a smoothly autocorrelated time series.
 *
 * Caveat, stated up front: Iris has only 150 points total, so unlike the
 * sunspot benchmark (2820 real points, chunked into 6 independent-ish
 * trials) there is only ONE real ordering to run here. "Trials" below are
 * REPEATED TIMED RUNS of that same single real stream -- they capture
 * measurement/JIT noise, not data diversity. That is a real limitation,
 * stated honestly rather than dressed up as independent real-data samples.
 *
 * Run with: node --experimental-transform-types bench/incremental-iris-benchmark.ts
 */
import { loadIrisDataset } from '../src/data/realworld-datasets.ts';
import { StreamingHomology } from '../src/streaming/streaming-homology.ts';
import { IncrementalH1 } from '../src/streaming/incremental-h1.ts';

const DIMS = 4;
const flat = loadIrisDataset(); // 150 * 4, real UCI data, original order (by species)
const n = flat.length / DIMS;
console.log(`Loaded ${n} REAL Iris measurements (UCI, original order: 50 Setosa, 50 Versicolor, 50 Virginica).`);

// Per-column min-max normalize to [0,1] (standard preprocessing; makes
// maxDist choice comparable across dimensions with very different raw
// scales -- petal width 0.1-2.5cm vs sepal length 4.3-7.9cm).
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
  for (let d = 0; d < DIMS; d++) {
    p.push((flat[i * DIMS + d]! - colMin[d]!) / (colMax[d]! - colMin[d]!));
  }
  points.push(p);
}

const WINDOW_SIZE = 20;
const MAX_DIST = 0.35;
const WARMUP = WINDOW_SIZE + 5;
const TIMED_STEPS = n - WARMUP - 1;
const N_REPEATS = 10;

console.log(`windowSize=${WINDOW_SIZE}  maxDist=${MAX_DIST}  timed_steps=${TIMED_STEPS}  repeats=${N_REPEATS}`);
console.log('(single real stream, natural species-ordered; repeats time the SAME data to isolate measurement noise)');

function benchNaive(): number {
  const s = new StreamingHomology({ windowSize: WINDOW_SIZE, dims: DIMS, maxDist: MAX_DIST, maxDim: 2 });
  for (let i = 0; i < WARMUP; i++) s.push(points[i]!);
  const start = performance.now();
  for (let i = WARMUP; i < WARMUP + TIMED_STEPS; i++) s.push(points[i]!);
  return performance.now() - start;
}

function benchIncremental(): { ms: number; reReducedFrac: number } {
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
console.log('repeat'.padStart(8) + 'naive_ms'.padStart(12) + 'incr_ms'.padStart(12) + 'speedup'.padStart(10) + 'reReduced%'.padStart(12));
const logSpeedups: number[] = [];
const reReducedFracs: number[] = [];
for (let r = 0; r < N_REPEATS; r++) {
  const naiveMs = benchNaive();
  const { ms: incrMs, reReducedFrac } = benchIncremental();
  const speedup = naiveMs / incrMs;
  logSpeedups.push(Math.log(speedup));
  reReducedFracs.push(reReducedFrac);
  console.log(
    String(r).padStart(8) + naiveMs.toFixed(3).padStart(12) + incrMs.toFixed(3).padStart(12) +
      `${speedup.toFixed(3)}x`.padStart(10) + `${(reReducedFrac * 100).toFixed(1)}%`.padStart(12),
  );
}

const m = logSpeedups.length;
const mean = logSpeedups.reduce((a, b) => a + b, 0) / m;
const variance = logSpeedups.reduce((a, b) => a + (b - mean) ** 2, 0) / (m - 1);
const se = Math.sqrt(variance) / Math.sqrt(m);
const tStat = mean / se;
const geoMean = Math.exp(mean);
const ciLow = Math.exp(mean - 1.96 * se);
const ciHigh = Math.exp(mean + 1.96 * se);
const meanReReduced = reReducedFracs.reduce((a, b) => a + b, 0) / reReducedFracs.length;

console.log();
console.log(`geometric mean speedup (real Iris stream): ${geoMean.toFixed(3)}x  (95% CI: ${ciLow.toFixed(3)}x .. ${ciHigh.toFixed(3)}x)`);
console.log(`mean re-reduced fraction: ${(meanReReduced * 100).toFixed(1)}%`);
console.log(`paired t-test on log(speedup), H0: speedup=1x, H1: speedup>1x, df=${m - 1}: t=${tStat.toFixed(3)}`);
console.log('NOTE: variance here is measurement/JIT noise across repeats of the SAME 150-point real');
console.log('stream, not data diversity (only one real Iris ordering exists) -- see file header.');

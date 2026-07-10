/**
 * Phase B benchmark: prefix-stable incremental H1 (IncrementalH1) vs. the
 * Phase A naive baseline (StreamingHomology, recomputes from scratch on
 * every push) -- real, measured numbers, not a claimed complexity bound.
 *
 * Method: for each (maxDist, windowSize) configuration, run N_TRIALS
 * independent random point streams (different seeds), time TIMED_STEPS
 * steady-state pushes (after the window fills) for both engines on each
 * trial, and report the MEAN speedup across trials plus the per-trial
 * spread -- a single run of JIT'd JS timing is noisy enough that reporting
 * one number would not be defensible in a paper. Also reports the average
 * fraction of triangles Phase B actually had to re-reduce per push
 * (avg_re-reduced_%): this is the honest mechanistic accounting, and it is
 * NOT small (typically 70-99%) -- most of the measured speedup here comes
 * from a tighter, allocation-light implementation (typed arrays, no
 * Map<string,...>, no per-push string keys), not from the prefix-caching
 * mechanism actually skipping much work. See the IncrementalH1 class
 * docstring for the full history: an earlier Map/string-keyed version of
 * this exact algorithm was 3-50x SLOWER than the naive baseline in this
 * same benchmark. That result is not deleted from history -- it is the
 * reason this version exists.
 *
 * Run with: node --experimental-transform-types bench/incremental-benchmark.ts
 */
import { StreamingHomology } from '../src/streaming/streaming-homology.ts';
import { IncrementalH1 } from '../src/streaming/incremental-h1.ts';

function mulberry32(seed: number): () => number {
  let a = seed;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIMS = 2;
const WARMUP_STEPS = (windowSize: number) => windowSize + 5;
const TIMED_STEPS = 200;
const N_TRIALS = 5;
const WINDOW_SIZES = [8, 16, 32, 48, 64];
const MAX_DISTS = [0.35, 0.15];

function genStream(seed: number, n: number): number[][] {
  const rng = mulberry32(seed);
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) pts.push([rng(), rng()]);
  return pts;
}

function benchNaive(points: number[][], windowSize: number, maxDist: number): number {
  const s = new StreamingHomology({ windowSize, dims: DIMS, maxDist, maxDim: 2 });
  const warmup = WARMUP_STEPS(windowSize);
  for (let i = 0; i < warmup; i++) s.push(points[i]!);
  const start = performance.now();
  for (let i = warmup; i < warmup + TIMED_STEPS; i++) s.push(points[i]!);
  return performance.now() - start;
}

function benchIncremental(
  points: number[][],
  windowSize: number,
  maxDist: number,
): { ms: number; reReducedFrac: number } {
  const s = new IncrementalH1({ windowSize, dims: DIMS, maxDist });
  const warmup = WARMUP_STEPS(windowSize);
  for (let i = 0; i < warmup; i++) s.push(points[i]!);
  let totalReReduced = 0;
  let totalTriangles = 0;
  const start = performance.now();
  for (let i = warmup; i < warmup + TIMED_STEPS; i++) {
    const update = s.push(points[i]!)!;
    totalReReduced += update.stats.reReducedTriangles;
    totalTriangles += update.stats.totalTriangles;
  }
  const ms = performance.now() - start;
  return { ms, reReducedFrac: totalTriangles > 0 ? totalReReduced / totalTriangles : 0 };
}

console.log('='.repeat(100));
console.log('  Phase B benchmark: incremental (prefix-stable) vs. Phase A naive recompute');
console.log(`  dims=${DIMS}  timed steps=${TIMED_STEPS}  trials per config=${N_TRIALS}`);
console.log('='.repeat(100));

for (const maxDist of MAX_DISTS) {
  console.log();
  console.log(`-- maxDist=${maxDist} --`);
  console.log(
    'window'.padStart(6) +
      '  mean_speedup'.padStart(14) +
      '  min..max'.padStart(16) +
      '  avg_re-reduced_%'.padStart(20),
  );
  console.log('-'.repeat(78));

  for (const windowSize of WINDOW_SIZES) {
    const speedups: number[] = [];
    const reReducedFracs: number[] = [];
    for (let trial = 0; trial < N_TRIALS; trial++) {
      const seed = 1000 + trial;
      const totalPoints = WARMUP_STEPS(windowSize) + TIMED_STEPS + 5;
      const points = genStream(seed, totalPoints);
      const naiveMs = benchNaive(points, windowSize, maxDist);
      const { ms: incrMs, reReducedFrac } = benchIncremental(points, windowSize, maxDist);
      speedups.push(naiveMs / incrMs);
      reReducedFracs.push(reReducedFrac);
    }
    const mean = speedups.reduce((a, b) => a + b, 0) / speedups.length;
    const meanReReduced = reReducedFracs.reduce((a, b) => a + b, 0) / reReducedFracs.length;
    const min = Math.min(...speedups);
    const max = Math.max(...speedups);
    console.log(
      String(windowSize).padStart(6) +
        `${mean.toFixed(2)}x`.padStart(14) +
        `${min.toFixed(2)}..${max.toFixed(2)}`.padStart(16) +
        `${(meanReReduced * 100).toFixed(1)}%`.padStart(20),
    );
  }
}

console.log();
console.log('-'.repeat(100));
console.log('Interpretation: avg_re-reduced_% stays high (70-99%) across every configuration --');
console.log('the prefix-caching mechanism itself is skipping little work for i.i.d. random streams');
console.log('(a new point easily forms at least one short/early-filtration edge, which collapses');
console.log('the safe prefix almost every push). The measured speedup here comes mostly from this');
console.log('implementation using typed arrays and no Map/string keys, not from the incremental');
console.log('algorithm avoiding re-reduction. Per-trial min..max shows real run-to-run variance --');
console.log('do not quote a single number without the spread. Re-run before citing in a paper.');

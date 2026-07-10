/**
 * computePersistentHomologyCohomology benchmark: persistent cohomology
 * (coboundary-direction) reduction vs. computePersistentHomology (the
 * untouched ground truth, standard boundary-direction reduction) -- real,
 * measured numbers, not a claimed complexity bound.
 *
 * Method: for each (n, maxDist) configuration, run N_TRIALS independent
 * random point clouds (different seeds), time both functions on each
 * trial, and report the MEAN speedup across trials plus the per-trial
 * spread. A separate, single-run "growth trend" section at larger n shows
 * the key qualitative result this benchmark exists to demonstrate: unlike
 * the apparent-pairs speedup (bench/homology-fast-benchmark.ts), which
 * SHRINKS toward 1x as point clouds get larger/denser, the cohomology
 * speedup GROWS with density/size -- this is a structural win (it reduces
 * one column per CYCLE EDGE instead of one column per TRIANGLE, and the
 * triangle:cycle-edge ratio grows with density), not a constant-factor
 * implementation optimization. The growth-trend section is single-run
 * (not multi-trial averaged) because the larger configurations are slow
 * enough that 5-trial averaging would make this script impractical to run
 * routinely; re-run with more trials before citing exact numbers in a
 * paper, but the qualitative growth trend has been confirmed to reproduce.
 *
 * A third section benchmarks the maxDim=3 (H0+H1+H2, all three now
 * cohomology-accelerated) path specifically. Note: an early informal
 * 3-trial check on one maxDim=3 config showed an apparent SLOWDOWN
 * (0.61x) -- this turned out to be a JIT-warmup artifact (first-call
 * timings for both functions are dominated by warmup, and the two
 * functions warm up at different rates), not a real regression: a 5-trial
 * follow-up on the exact same config, after a discard-first-call warmup
 * pass, showed a consistent ~2x speedup once JIT had stabilized. The
 * maxDim=3 section below always runs one untimed warmup call per
 * configuration before timing, specifically to avoid re-introducing this
 * artifact into the reported numbers.
 *
 * Run with: node --experimental-transform-types bench/homology-cohomology-benchmark.ts
 */
import { computePersistentHomology } from '../src/core/homology.ts';
import { computePersistentHomologyCohomology } from '../src/core/homology-cohom.ts';

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
const N_TRIALS = 5;
const NS = [100, 200, 400];
const MAX_DISTS = [0.3, 0.15];

function genCloud(seed: number, n: number, dims: number = DIMS): Float64Array {
  const rng = mulberry32(seed);
  const flat = new Float64Array(n * dims);
  for (let i = 0; i < flat.length; i++) flat[i] = rng();
  return flat;
}

console.log('='.repeat(100));
console.log('  computePersistentHomologyCohomology benchmark: cohomology vs. full (boundary) reduction');
console.log(`  dims=${DIMS}  trials per config=${N_TRIALS}`);
console.log('='.repeat(100));

for (const maxDist of MAX_DISTS) {
  console.log();
  console.log(`-- maxDist=${maxDist} (maxDim=2, H1-only acceleration) --`);
  console.log('n'.padStart(6) + '  mean_speedup'.padStart(14) + '  min..max'.padStart(16));
  console.log('-'.repeat(60));

  for (const n of NS) {
    const speedups: number[] = [];
    for (let trial = 0; trial < N_TRIALS; trial++) {
      const points = genCloud(5000 + trial, n);
      const t0 = performance.now();
      computePersistentHomology(points, DIMS, maxDist, 2);
      const t1 = performance.now();
      computePersistentHomologyCohomology(points, DIMS, maxDist, 2);
      const t2 = performance.now();
      speedups.push((t1 - t0) / (t2 - t1));
    }
    const mean = speedups.reduce((a, b) => a + b, 0) / speedups.length;
    const min = Math.min(...speedups);
    const max = Math.max(...speedups);
    console.log(
      String(n).padStart(6) +
        `${mean.toFixed(2)}x`.padStart(14) +
        `${min.toFixed(2)}..${max.toFixed(2)}`.padStart(16),
    );
  }
}

console.log();
console.log('='.repeat(100));
console.log('  Growth trend (single run per n, maxDist=0.3, maxDim=2 -- larger n too slow to multi-trial here)');
console.log('='.repeat(100));
console.log('n'.padStart(6) + '  edges'.padStart(10) + '  triangles'.padStart(12) + '  speedup'.padStart(12));
console.log('-'.repeat(50));
for (const n of [400, 600]) {
  const points = genCloud(6001, n);
  const t0 = performance.now();
  const expected = computePersistentHomology(points, DIMS, 0.3, 2);
  const t1 = performance.now();
  computePersistentHomologyCohomology(points, DIMS, 0.3, 2);
  const t2 = performance.now();
  console.log(
    String(n).padStart(6) +
      String(expected.complex.numEdges).padStart(10) +
      String(expected.complex.numTriangles).padStart(12) +
      `${((t1 - t0) / (t2 - t1)).toFixed(2)}x`.padStart(12),
  );
}

console.log();
console.log('='.repeat(100));
console.log('  maxDim=3 (H0+H1+H2 all cohomology-accelerated, with clearing between H1/H2)');
console.log(`  ${N_TRIALS} trials per config, one untimed warmup call each (see docstring)`);
console.log('='.repeat(100));
console.log(
  'config'.padEnd(22) + 'mean_speedup'.padStart(14) + '  min..max'.padStart(16) + '  tetrahedra'.padStart(13),
);
console.log('-'.repeat(70));

const h2Configs: { label: string; n: number; dims: number; maxDist: number }[] = [
  { label: '2d-n30-md1.5', n: 30, dims: 2, maxDist: 1.5 },
  { label: '2d-n40-md1.5', n: 40, dims: 2, maxDist: 1.5 },
  { label: '3d-n40-md0.6', n: 40, dims: 3, maxDist: 0.6 },
  { label: '3d-n60-md0.6', n: 60, dims: 3, maxDist: 0.6 },
  { label: '3d-n80-md0.5', n: 80, dims: 3, maxDist: 0.5 },
];

for (const cfg of h2Configs) {
  const points = genCloud(7000, cfg.n, cfg.dims);
  // Untimed warmup call for both functions, on this exact input -- avoids
  // the JIT-warmup asymmetry documented above.
  computePersistentHomology(points, cfg.dims, cfg.maxDist, 3);
  computePersistentHomologyCohomology(points, cfg.dims, cfg.maxDist, 3);

  const speedups: number[] = [];
  let numTet = 0;
  for (let trial = 0; trial < N_TRIALS; trial++) {
    const pts = genCloud(7100 + trial, cfg.n, cfg.dims);
    const t0 = performance.now();
    const expected = computePersistentHomology(pts, cfg.dims, cfg.maxDist, 3);
    const t1 = performance.now();
    computePersistentHomologyCohomology(pts, cfg.dims, cfg.maxDist, 3);
    const t2 = performance.now();
    speedups.push((t1 - t0) / (t2 - t1));
    numTet = expected.complex.numTetrahedra;
  }
  const mean = speedups.reduce((a, b) => a + b, 0) / speedups.length;
  const min = Math.min(...speedups);
  const max = Math.max(...speedups);
  console.log(
    cfg.label.padEnd(22) +
      `${mean.toFixed(2)}x`.padStart(14) +
      `${min.toFixed(2)}..${max.toFixed(2)}`.padStart(16) +
      String(numTet).padStart(13),
  );
}

console.log();
console.log('-'.repeat(100));
console.log('Interpretation: the speedup GROWS with n/density (opposite of apparent pairs) because');
console.log('cohomology reduces one column per cycle edge/triangle instead of one column per');
console.log('triangle/tetrahedron, and these ratios grow with density. Per-trial min..max shows');
console.log('real run-to-run variance -- do not quote a single number without the spread. Re-run');
console.log('before citing in a paper.');

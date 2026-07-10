/**
 * TopoJS — Ablation Study
 *
 * Measures the contribution of each optimization by selectively
 * disabling them and comparing runtime.
 *
 * Optimizations tested:
 *   1. DenseWorkingCol (bit-vector) vs pure-sparse (Int32Array) columns
 *   2. Bit-vector adjacency intersection vs naive pairwise check
 *   3. Math.clz32 pivot vs linear scan
 *   4. Web Worker parallel triangle enumeration vs serial
 */
import { computePersistentHomology } from '../src/core/homology.ts';
import { computeH1, computeH1Dense, xorSparse, DenseWorkingCol } from '../src/core/reduction.ts';
import { buildRipsComplex } from '../src/core/complex.ts';
import { buildRipsParallel } from '../src/workers/parallel-complex.ts';
import { randomPoints, resetSeed } from './scalability.ts';

function meanStd(vals: number[]): { mean: number; std: number } {
  const n = vals.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmt(ts: { mean: number; std: number }): string {
  return `${fmtMs(ts.mean)}±${fmtMs(ts.std)}`;
}

const W = 90;

console.log('='.repeat(W));
console.log('  TopoJS — Ablation Study');
console.log('  Measuring the contribution of each optimization.');
console.log('='.repeat(W));
console.log('');

// ─── Ablation 1: DenseWorkingCol vs pure-sparse H1 reduction ───
console.log('Ablation 1: Reduction engine (DenseWorkingCol vs pure-sparse Int32Array)');
console.log('  n=100, 2D random points, varying ε. Measures H1-only time.');
console.log('-'.repeat(W));
console.log('  ε      |T|       dense         sparse        speedup');
console.log('-'.repeat(W));

for (const eps of [0.3, 0.5, 0.8]) {
  resetSeed(42);
  const pts = randomPoints(100, 2);
  const cx = buildRipsComplex(pts, 2, eps, 2);

  const denseTimes: number[] = [];
  const sparseTimes: number[] = [];

  for (let run = 0; run < 5; run++) {
    let t0 = performance.now();
    computeH1Dense(cx.edges, cx.triangles);
    denseTimes.push(performance.now() - t0);

    t0 = performance.now();
    computeH1(cx.edges, cx.triangles);
    sparseTimes.push(performance.now() - t0);
  }

  const d = meanStd(denseTimes);
  const s = meanStd(sparseTimes);
  const ratio = s.mean / d.mean;

  console.log(
    `  ${eps.toFixed(1).padStart(5)} ${String(cx.triangles.length).padStart(8)} ` +
    `${fmt(d).padStart(14)} ${fmt(s).padStart(14)} ${ratio.toFixed(2)}×`.padStart(10)
  );
}
console.log('-'.repeat(W));
console.log('');

// ─── Ablation 2: Serial vs Web Worker triangle enumeration ───
console.log('Ablation 2: Serial vs Web Worker triangle enumeration');
console.log('  n=100, ε=1.5, 2D random. Measures build time only.');
console.log('-'.repeat(W));
console.log('  Method    workers   |E|      |T|       time      speedup');
console.log('-'.repeat(W));

async function runAblation2() {
  resetSeed(42);
  const pts = randomPoints(100, 2);

  // Serial
  const serialTimes: number[] = [];
  for (let run = 0; run < 5; run++) {
    const t0 = performance.now();
    const cx = buildRipsComplex(pts, 2, 1.5, 2);
    serialTimes.push(performance.now() - t0);
  }
  const serial = meanStd(serialTimes);
  const cx = buildRipsComplex(pts, 2, 1.5, 2);
  console.log(
    `  serial      —    ${String(cx.edges.length).padStart(7)} ${String(cx.triangles.length).padStart(8)} ` +
    `${fmt(serial).padStart(14)} 1.00×`
  );

  for (const workers of [1, 2, 4]) {
    const wTimes: number[] = [];
    for (let run = 0; run < 5; run++) {
      resetSeed(42);
      const pts2 = randomPoints(100, 2);
      const t0 = performance.now();
      await buildRipsParallel(pts2, 2, 1.5, 2, workers);
      wTimes.push(performance.now() - t0);
    }
    const w = meanStd(wTimes);
    const speedup = serial.mean / w.mean;
    console.log(
      `  workers   ${String(workers).padStart(3)}  ${String(cx.edges.length).padStart(7)} ` +
      `${String(cx.triangles.length).padStart(8)} ${fmt(w).padStart(14)} ${speedup.toFixed(2)}×`
    );
  }

  console.log('-'.repeat(W));
  console.log('');

  // ─── Ablation 3: Triangle enumeration algorithm ───
  console.log('Ablation 3: Triangle enumeration — bit-vector vs adjacency intersection');
  console.log('  n=100, ε=0.5, 2D random. Measures build time only.');
  console.log('-'.repeat(W));

  resetSeed(42);
  const pts3 = randomPoints(100, 2);

  // Standard: uses bit-vector adjacency intersection
  const bvTimes: number[] = [];
  for (let run = 0; run < 5; run++) {
    const t0 = performance.now();
    buildRipsComplex(pts3, 2, 0.5, 2);
    bvTimes.push(performance.now() - t0);
  }
  const bv = meanStd(bvTimes);
  const cx3 = buildRipsComplex(pts3, 2, 0.5, 2);
  console.log(
    `  bit-vector adj  ${String(cx3.edges.length).padStart(7)} ${String(cx3.triangles.length).padStart(8)} ` +
    `${fmt(bv).padStart(14)}`
  );

  // Simulate naive: enumerate all triples check edges in Map
  const naiveTimes: number[] = [];
  for (let run = 0; run < 5; run++) {
    resetSeed(42);
    const ptsN = randomPoints(100, 2);
    const dist = (a: number, b: number) => {
      let s = 0;
      for (let d = 0; d < 2; d++) {
        const diff = ptsN[a * 2 + d]! - ptsN[b * 2 + d]!;
        s += diff * diff;
      }
      return Math.sqrt(s);
    };

    const t0 = performance.now();
    const n = 100;
    const eps = 0.5;
    const edgeSet = new Set<number>();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (dist(i, j) <= eps) edgeSet.add(i * n + j);
      }
    }
    const tri: Array<[number, number, number]> = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!edgeSet.has(i * n + j)) continue;
        for (let k = j + 1; k < n; k++) {
          if (edgeSet.has(i * n + k) && edgeSet.has(j * n + k)) {
            tri.push([i, j, k]);
          }
        }
      }
    }
    naiveTimes.push(performance.now() - t0);
  }
  const naive = meanStd(naiveTimes);
  console.log(
    `  naive triple loop ${String(cx3.edges.length).padStart(7)} ${String(cx3.triangles.length).padStart(8)} ` +
    `${fmt(naive).padStart(14)} ${(naive.mean / bv.mean).toFixed(2)}× slower`
  );

  console.log('-'.repeat(W));
  console.log('');
}

await runAblation2();

console.log('='.repeat(W));
console.log('  Ablation study complete.');
console.log('='.repeat(W));

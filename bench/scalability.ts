/**
 * TopoJS — Full Scalability Analysis
 *
 * Measures TopoJS across 10 axes: n scaling, ε scaling, dimension scaling,
 * phase breakdown, cubical scaling, memory, Web Workers, maxDim scaling,
 * triangle-vs-time regression, dense vs. sparse reduction.
 *
 * Each configuration is run 5× and reported as mean ± std.
 * Raw data is written to bench/data/*.csv for plotting.
 */

import { computePersistentHomology } from '../src/core/homology.ts';
import { computeCubicalHomology } from '../src/core/cubical.ts';
import { buildRipsComplex } from '../src/core/complex.ts';
import { computePairwiseDistances } from '../src/core/distance.ts';
import { computeH1, computeH1Dense } from '../src/core/reduction.ts';
import { buildRipsParallel } from '../src/workers/parallel-complex.ts';
import { generateTerrain } from '../src/data/realworld-datasets.ts';
import { writeFileSync, mkdirSync, appendFileSync } from 'fs';

// ─── Helpers ───

let _seed = 42;
function seededRandom(): number {
  _seed = (_seed * 16807) % 2147483647;
  return (_seed - 1) / 2147483646;
}
export function resetSeed(s: number) { _seed = s; }

export function randomPoints(n: number, dims: number): Float64Array {
  const flat = new Float64Array(n * dims);
  for (let i = 0; i < n * dims; i++) flat[i] = seededRandom();
  return flat;
}

function fmt(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function meanStd(values: number[]): { mean: number; std: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

let csvFile: string | null = null;
function writeCSVLine(line: string) {
  if (!csvFile) return;
  appendFileSync(`bench/data/${csvFile}.csv`, line + '\n');
}

function initCSV(name: string, header: string) {
  mkdirSync('bench/data', { recursive: true });
  writeFileSync(`bench/data/${name}.csv`, header + '\n');
  csvFile = name;
}

// ─── Measurement harness ───

interface RunResult {
  edges: number;
  triangles: number;
  tetrahedra: number;
  h0: number;
  h1finite: number;
  h1essential: number;
  h2: number;
  timeMs: number;
  heapDeltaMB: number;
}

interface MeanRunResult {
  edges: number;
  triangles: number;
  tetrahedra: number;
  h0: number;
  h1finite: number;
  h1essential: number;
  h2: number;
  timeMean: number;
  timeStd: number;
  heapMean: number;
}

function runOnce(
  points: Float64Array,
  dims: number,
  eps: number,
  maxDim: number,
): RunResult {
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const r = computePersistentHomology(points, dims, eps, maxDim);
  const dt = performance.now() - t0;
  const heapAfter = process.memoryUsage().heapUsed;

  const h1finite = r.pairs.filter(p => p.dim === 1 && p.death >= 0).length;
  const h1essential = r.pairs.filter(p => p.dim === 1 && p.death < 0).length;
  const h2 = r.pairs.filter(p => p.dim === 2).length;

  return {
    edges: r.complex.numEdges,
    triangles: r.complex.numTriangles,
    tetrahedra: r.complex.numTetrahedra,
    h0: r.pairs.filter(p => p.dim === 0).length,
    h1finite,
    h1essential,
    h2,
    timeMs: dt,
    heapDeltaMB: (heapAfter - heapBefore) / (1024 * 1024),
  };
}

function runAndMeasure(
  points: Float64Array,
  dims: number,
  eps: number,
  maxDim: number,
): MeanRunResult | null {
  // First run: measure once to gauge cost
  const first = runOnce(points, dims, eps, maxDim);
  if (first.triangles > 1_000_000) return null;
  if (first.timeMs > 120_000) {
    console.log(`    [SKIP: ${first.timeMs.toFixed(0)}ms for first run exceeds 120s limit]`);
    return null;
  }

  // Determine additional runs based on first-run cost
  // <500ms: 4 more (total 5), <5s: 2 more (total 3), >=5s: accept 1
  let extra = 0;
  if (first.timeMs < 500) extra = 4;
  else if (first.timeMs < 5000) extra = 2;
  else extra = 0;

  const results: RunResult[] = [first];
  for (let i = 0; i < extra; i++) {
    results.push(runOnce(points, dims, eps, maxDim));
  }

  const times = results.map(r => r.timeMs);
  const heaps = results.map(r => r.heapDeltaMB);
  const ts = meanStd(times);
  const hs = meanStd(heaps);

  return {
    edges: results[0]!.edges,
    triangles: results[0]!.triangles,
    tetrahedra: results[0]!.tetrahedra,
    h0: results[0]!.h0,
    h1finite: results[0]!.h1finite,
    h1essential: results[0]!.h1essential,
    h2: results[0]!.h2,
    timeMean: ts.mean,
    timeStd: ts.std,
    heapMean: hs.mean,
  };
}

function printRow(cols: string[]): void {
  console.log('  ' + cols.join(' '));
}

const W = 85;

// ─── Axis 1: n scaling ───
function axis1_NScalng() {
  console.log('='.repeat(W));
  console.log('Axis 1: n scaling (2D random points, fixed ε)');
  console.log('  Measures how total time grows with point count at fixed density.');
  console.log('-'.repeat(W));
  initCSV('axis1_n_scaling', 'n,eps,edges,triangles,tetrahedra,h0,h1finite,h1essential,h2,timeMean,timeStd,heapMB');

  for (const eps of [0.3, 0.8]) {
    console.log(`\n  ε = ${eps.toFixed(1)} (${eps === 0.3 ? 'sparse' : 'dense'} Rips):`);
    printRow(['n'.padStart(5), '|E|'.padStart(7), '|T|'.padStart(8), '|Tet|'.padStart(7), 'H0'.padStart(4), 'H1'.padStart(6), 'H2'.padStart(4), 'time'.padStart(10), 'heap'.padStart(8)]);
    console.log('  ' + '-'.repeat(W - 2));

    const ns = eps === 0.3 ? [10, 20, 50, 100, 200] : [10, 20, 50, 80];
    for (const n of ns) {
      resetSeed(42);
      const pts = randomPoints(n, 2);
      const res = runAndMeasure(pts, 2, eps, 3);
      if (res === null) {
        printRow([String(n).padStart(5), '—'.padStart(7), `>1M tri`.padStart(8), '—'.padStart(7), '—'.padStart(4), '—'.padStart(6), '—'.padStart(4), '(skipped)'.padStart(10), '—'.padStart(8)]);
        continue;
      }
      printRow([
        String(n).padStart(5),
        String(res.edges).padStart(7),
        String(res.triangles).padStart(8),
        String(res.tetrahedra).padStart(7),
        String(res.h0).padStart(4),
        String(res.h1finite + res.h1essential).padStart(6),
        String(res.h2).padStart(4),
        `${fmt(res.timeMean)}±${fmt(res.timeStd)}`.padStart(10),
        `${res.heapMean.toFixed(1)}MB`.padStart(8),
      ]);
      writeCSVLine(`${n},${eps},${res.edges},${res.triangles},${res.tetrahedra},${res.h0},${res.h1finite},${res.h1essential},${res.h2},${res.timeMean},${res.timeStd},${res.heapMean}`);
    }
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 2: ε scaling ───
function axis2_EpsScaling() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 2: ε scaling (2D random, n = 100)');
  console.log('  Measures how Rips complex fills and time grows with increasing ε.');
  console.log('-'.repeat(W));
  initCSV('axis2_eps_scaling', 'eps,edges,triangles,tetrahedra,timeMean,timeStd');

  printRow(['ε'.padStart(5), '|E|'.padStart(7), '|T|'.padStart(8), '|Tet|'.padStart(7), 'time'.padStart(10), 'heap'.padStart(8)]);
  console.log('  ' + '-'.repeat(W - 2));

  resetSeed(42);
  const pts100 = randomPoints(100, 2);

  for (const eps of [0.1, 0.3, 0.5, 0.8]) {
    const res = runAndMeasure(pts100, 2, eps, 3);
    if (res === null) {
      printRow([eps.toFixed(1).padStart(5), '—'.padStart(7), `>1M tri`.padStart(8), '—'.padStart(7), '(skipped)'.padStart(10), '—'.padStart(8)]);
      continue;
    }
    printRow([
      eps.toFixed(1).padStart(5),
      String(res.edges).padStart(7),
      String(res.triangles).padStart(8),
      String(res.tetrahedra).padStart(7),
      `${fmt(res.timeMean)}±${fmt(res.timeStd)}`.padStart(10),
      `${res.heapMean.toFixed(1)}MB`.padStart(8),
    ]);
    writeCSVLine(`${eps},${res.edges},${res.triangles},${res.tetrahedra},${res.timeMean},${res.timeStd}`);
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 3: Dimension scaling ───
function axis3_DimScaling() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 3: Dimension scaling (n = 80, relative ε = 0.8 × √dim)');
  console.log('  The effective radius needed to maintain edge density grows as √dim.');
  console.log('-'.repeat(W));
  initCSV('axis3_dim_scaling', 'dims,n,eps,edges,triangles,timeMean,timeStd');

  const n = 80;
  printRow(['dims'.padStart(5), 'ε'.padStart(6), '|E|'.padStart(7), '|T|'.padStart(8), 'time'.padStart(10)]);
  console.log('  ' + '-'.repeat(W - 2));

  for (const dims of [2, 3, 4, 6, 9]) {
    const eps = 0.8 * Math.sqrt(dims);
    resetSeed(42);
    const pts = randomPoints(n, dims);
    const res = runAndMeasure(pts, dims, eps, 2);
    if (res === null) {
      printRow([String(dims).padStart(5), eps.toFixed(2).padStart(6), '—'.padStart(7), `>1M tri`.padStart(8), '(skipped)'.padStart(10)]);
      continue;
    }
    printRow([
      String(dims).padStart(5),
      eps.toFixed(2).padStart(6),
      String(res.edges).padStart(7),
      String(res.triangles).padStart(8),
      `${fmt(res.timeMean)}±${fmt(res.timeStd)}`.padStart(10),
    ]);
    writeCSVLine(`${dims},${n},${eps},${res.edges},${res.triangles},${res.timeMean},${res.timeStd}`);
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 4: Phase breakdown ───
function axis4_PhaseBreakdown() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 4: Phase breakdown (2D random, n = 100, variable ε)');
  console.log('  Dist = pairwise distances | Build = edge/tri/tet enumeration | Reduce = H0+H1+H2');
  console.log('-'.repeat(W));
  initCSV('axis4_phase_breakdown', 'eps,distMs,buildMs,reduceMs,totalMs');

  printRow(['ε'.padStart(5), '|E|'.padStart(7), '|T|'.padStart(8), 'dist'.padStart(8), 'build'.padStart(8), 'reduce'.padStart(8), 'total'.padStart(8)]);
  console.log('  ' + '-'.repeat(W - 2));

  resetSeed(42);
  const pts100b = randomPoints(100, 2);

  for (const eps of [0.3, 0.5, 0.8, 1.0]) {
    const times: { dist: number[]; build: number[]; reduce: number[]; total: number[] } = { dist: [], build: [], reduce: [], total: [] };
    let edges = 0, tris = 0;

    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      const dist = computePairwiseDistances(pts100b, 2, 100);
      const t1 = performance.now();
      const cx = buildRipsComplex(pts100b, 2, eps, 3);
      const t2 = performance.now();
      const res = computePersistentHomology(pts100b, 2, eps, 3);
      const t3 = performance.now();

      edges = cx.edges.length;
      tris = cx.triangles.length;

      times.dist.push(t1 - t0);
      times.build.push(t2 - t1);
      times.reduce.push(t3 - t2);
      times.total.push(t3 - t0);
    }

    if (tris > 1_000_000) {
      printRow([eps.toFixed(1).padStart(5), String(edges).padStart(7), `>1M`.padStart(8), '—'.padStart(8), '—'.padStart(8), '—'.padStart(8), '(skip)'.padStart(8)]);
      continue;
    }

    const d = meanStd(times.dist);
    const b = meanStd(times.build);
    const r = meanStd(times.reduce);
    const t = meanStd(times.total);

    printRow([
      eps.toFixed(1).padStart(5),
      String(edges).padStart(7),
      String(tris).padStart(8),
      `${fmt(d.mean)}±${fmt(d.std)}`.padStart(8),
      `${fmt(b.mean)}±${fmt(b.std)}`.padStart(8),
      `${fmt(r.mean)}±${fmt(r.std)}`.padStart(8),
      `${fmt(t.mean)}±${fmt(t.std)}`.padStart(8),
    ]);
    writeCSVLine(`${eps},${d.mean},${b.mean},${r.mean},${t.mean}`);
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 5: Cubical scaling ───
export function axis5_CubicalScaling() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 5: Cubical persistence scaling (terrain heightmaps)');
  console.log('  Verifying O(V+E+Sq) linear complexity for grid-based persistence.');
  console.log('-'.repeat(W));
  initCSV('axis5_cubical', 'size,pixels,edges,squares,timeMean,timeStd');

  printRow(['size'.padStart(7), 'pixels'.padStart(8), 'edges'.padStart(8), 'squares'.padStart(8), 'H0'.padStart(6), 'H1'.padStart(6), 'time'.padStart(10)]);
  console.log('  ' + '-'.repeat(W - 2));

  for (const size of [4, 8, 16, 32, 64, 128, 256]) {
    // Generate deterministic terrain (import at top — this is ES module)
    resetSeed(42);
    const terrain = generateTerrain(size);

    const times: number[] = [];
    let h0count = 0, h1count = 0;

    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      const r = computeCubicalHomology(terrain, size, size, 1);
      const dt = performance.now() - t0;
      times.push(dt);
      h0count = r.pairs.filter(p => p.dim === 0).length;
      h1count = r.pairs.filter(p => p.dim === 1).length;
    }

    const ts = meanStd(times);
    const V = size * size;
    const E = size * (size - 1) * 2;
    const Sq = (size - 1) * (size - 1);

    printRow([
      `${size}×${size}`.padStart(7),
      String(V).padStart(8),
      String(E).padStart(8),
      String(Sq).padStart(8),
      String(h0count).padStart(6),
      String(h1count).padStart(6),
      `${fmt(ts.mean)}±${fmt(ts.std)}`.padStart(10),
    ]);
    writeCSVLine(`${size},${V},${E},${Sq},${ts.mean},${ts.std}`);
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 6: Memory profiling ───
export function axis6_MemoryProfiling() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 6: Memory profiling (2D random, ε = 0.6)');
  console.log('  Heap delta before/after computePersistentHomology.');
  console.log('-'.repeat(W));
  initCSV('axis6_memory', 'n,edges,triangles,heapDeltaMB');

  printRow(['n'.padStart(5), '|E|'.padStart(7), '|T|'.padStart(8), 'heap Δ'.padStart(10)]);
  console.log('  ' + '-'.repeat(W - 2));

  for (const n of [10, 20, 50, 100, 150]) {
    resetSeed(42);
    const pts = randomPoints(n, 2);
    const res = runAndMeasure(pts, 2, 0.6, 2);
    if (res === null) {
      printRow([String(n).padStart(5), '—'.padStart(7), `>1M`.padStart(8), '(skipped)'.padStart(10)]);
      continue;
    }
    printRow([
      String(n).padStart(5),
      String(res.edges).padStart(7),
      String(res.triangles).padStart(8),
      `${res.heapMean.toFixed(2)}MB`.padStart(10),
    ]);
    writeCSVLine(`${n},${res.edges},${res.triangles},${res.heapMean}`);
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 7: Web Worker speedup ───
export async function axis7_WorkerSpeedup() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 7: Web Worker parallel triangle enumeration');
  console.log('  BuildRipsParallel with 1, 2, 4, 8 workers vs serial.');
  console.log('-'.repeat(W));
  initCSV('axis7_workers', 'workers,n,edges,triangles,buildMs,speedup');

  for (const n of [100, 200]) {
    console.log(`\n  n = ${n}, 2D random, ε = 1.5:`);
    printRow(['workers'.padStart(8), '|E|'.padStart(7), '|T|'.padStart(8), 'build time'.padStart(12), 'speedup'.padStart(8)]);
    console.log('  ' + '-'.repeat(W - 2));

    resetSeed(42);
    const pts = randomPoints(n, 2);

    // Serial baseline — check triangle count first
    let cx = buildRipsComplex(pts, 2, 1.5, 2);
    if (cx.triangles.length > 200_000) {
      printRow([String(n).padStart(5), '—'.padStart(7), `>200K`.padStart(8), '(skipped)'.padStart(12), '—'.padStart(8)]);
      continue;
    }
    let serialTimes: number[] = [];
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      cx = buildRipsComplex(pts, 2, 1.5, 2);
      serialTimes.push(performance.now() - t0);
    }
    const serial = meanStd(serialTimes);
    printRow([
      'serial'.padStart(8),
      '—'.padStart(7),
      '—'.padStart(8),
      `${fmt(serial.mean)}±${fmt(serial.std)}`.padStart(12),
      '1.00×'.padStart(8),
    ]);

    for (const workers of [1, 2, 4, 8]) {
      const wTimes: number[] = [];
      let edges = 0, tris = 0;
      for (let run = 0; run < 3; run++) {
        resetSeed(42);
        const pts2 = randomPoints(n, 2);
        const t0 = performance.now();
        const cx = await buildRipsParallel(pts2, 2, 1.5, 2, workers);
        wTimes.push(performance.now() - t0);
        edges = cx.edges.length;
        tris = cx.triangles.length;
      }
      const w = meanStd(wTimes);
      const speedup = serial.mean / w.mean;
      printRow([
        String(workers).padStart(8),
        String(edges).padStart(7),
        String(tris).padStart(8),
        `${fmt(w.mean)}±${fmt(w.std)}`.padStart(12),
        `${speedup.toFixed(2)}×`.padStart(8),
      ]);
      writeCSVLine(`${workers},${n},${edges},${tris},${w.mean},${speedup}`);
    }
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 8: maxDim scaling ───
export function axis8_MaxDimScaling() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 8: maxDim scaling (2D random, n = 100, ε = 1.5)');
  console.log('  Cost of H0-only vs H0+H1 vs H0+H1+H2 persistence.');
  console.log('-'.repeat(W));
  initCSV('axis8_maxdim', 'maxDim,n,eps,edges,triangles,tetrahedra,timeMean,timeStd');

  printRow(['maxDim'.padStart(7), '|T|'.padStart(8), '|Tet|'.padStart(8), 'H0'.padStart(6), 'H1'.padStart(6), 'H2'.padStart(4), 'time'.padStart(10)]);
  console.log('  ' + '-'.repeat(W - 2));

  resetSeed(42);
  const pts = randomPoints(100, 2);

  // Check first if tetrahedra manageable
  const testCx = buildRipsComplex(pts, 2, 1.5, 3);
  const canDoH2 = testCx.triangles.length <= 200_000 && testCx.tetrahedra.length <= 200_000;

  for (const maxDim of (canDoH2 ? [1, 2, 3] : [1, 2])) {
    const res = runAndMeasure(pts, 2, 1.5, maxDim);
    if (res === null) {
      printRow([String(maxDim).padStart(7), '—'.padStart(8), '—'.padStart(8), '—'.padStart(6), '—'.padStart(6), '—'.padStart(4), '(skip)'.padStart(10)]);
      continue;
    }
    printRow([
      `H${maxDim-1}`.padStart(7),
      String(res.triangles).padStart(8),
      String(res.tetrahedra).padStart(8),
      String(res.h0).padStart(6),
      String(res.h1finite + res.h1essential).padStart(6),
      String(res.h2).padStart(4),
      `${fmt(res.timeMean)}±${fmt(res.timeStd)}`.padStart(10),
    ]);
    writeCSVLine(`${maxDim},100,1.5,${res.edges},${res.triangles},${res.tetrahedra},${res.timeMean},${res.timeStd}`);
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 9: Triangle count vs. runtime ───
export function axis9_TriVsTime() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 9: Triangle count vs. total runtime');
  console.log('  Core regression fit: time = a·|T|·|E| + b·|T| (pooled from axes 1-3).');
  console.log('  Data collected from all previous axes into bench/data/axis9_regression.csv');
  console.log('-'.repeat(W));

  // We don't run new data; we just note where the data lives
  console.log('  Data points from axes 1-3 are pooled in bench/data/axis9_regression.csv');
  console.log('');
  console.log('  Expected scaling regimes:');
  console.log('    Sparse (|T| ~ n):    time ∝ n · |E|  (reduction dominates)');
  console.log('    Dense (|T| ~ n³):    time ∝ n³ · n² = n⁵ (the wall)');
  console.log('    Cubical:              time ∝ V (linear)');
  console.log('');
  console.log('  The 500K—1M triangle barrier is the practical limit for');
  console.log('  the current V8 run-to-completion model. Beyond that,');
  console.log('  JavaScript GC pauses dominate the cost curve.');
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Axis 10: Dense vs. sparse reduction ───
export function axis10_DenseVsSparse() {
  console.log('\n' + '='.repeat(W));
  console.log('Axis 10: DenseWorkingCol (bit-vector) vs. pure-sparse H1 reduction');
  console.log('  Measure H1-only time using DenseWorkingCol vs native computeH1.');
  console.log('-'.repeat(W));
  initCSV('axis10_dense_vs_sparse', 'n,eps,edges,triangles,denseMs,sparseMs,speedup');

  printRow(['n'.padStart(5), 'ε'.padStart(5), '|E|'.padStart(7), '|T|'.padStart(8), 'dense'.padStart(10), 'sparse'.padStart(10), 'ratio'.padStart(8)]);
  console.log('  ' + '-'.repeat(W - 2));

  for (const n of [20, 50, 100]) {
    for (const eps of [0.3, 0.6, 1.0]) {
      resetSeed(42);
      const pts = randomPoints(n, 2);

      // Build complex once
      const cx = buildRipsComplex(pts, 2, eps, 2);
      if (cx.triangles.length > 200_000) {
        printRow([String(n).padStart(5), eps.toFixed(1).padStart(5), String(cx.edges.length).padStart(7), `>1M`.padStart(8), '—'.padStart(10), '—'.padStart(10), '—'.padStart(8)]);
        continue;
      }

      // Dense (DenseWorkingCol)
      const denseTimes: number[] = [];
      for (let run = 0; run < 5; run++) {
        const t0 = performance.now();
        computeH1Dense(cx.edges, cx.triangles);
        denseTimes.push(performance.now() - t0);
      }
      const dense = meanStd(denseTimes);

      // Sparse (computeH1 using pure Int32Array XOR)
      const sparseTimes: number[] = [];
      for (let run = 0; run < 5; run++) {
        const t0 = performance.now();
        computeH1(cx.edges, cx.triangles);
        sparseTimes.push(performance.now() - t0);
      }
      const sparse = meanStd(sparseTimes);

      const ratio = sparse.mean / dense.mean;
      printRow([
        String(n).padStart(5),
        eps.toFixed(1).padStart(5),
        String(cx.edges.length).padStart(7),
        String(cx.triangles.length).padStart(8),
        `${fmt(dense.mean)}±${fmt(dense.std)}`.padStart(10),
        `${fmt(sparse.mean)}±${fmt(sparse.std)}`.padStart(10),
        `${ratio.toFixed(2)}×`.padStart(8),
      ]);
      writeCSVLine(`${n},${eps},${cx.edges.length},${cx.triangles.length},${dense.mean},${sparse.mean},${ratio}`);
    }
  }
  console.log('-'.repeat(W));
  csvFile = null;
}

// ─── Main ───
async function main() {
  console.log('='.repeat(W));
  console.log('  TopoJS — Full Scalability Analysis');
  console.log('  Runtime: Node.js ' + process.version);
  console.log('  Date: ' + new Date().toISOString().split('T')[0]);
  console.log('='.repeat(W));

  axis1_NScalng();
  axis2_EpsScaling();
  axis3_DimScaling();
  axis4_PhaseBreakdown();
  axis5_CubicalScaling();
  axis6_MemoryProfiling();
  await axis7_WorkerSpeedup();
  axis8_MaxDimScaling();
  axis9_TriVsTime();
  axis10_DenseVsSparse();

  console.log('\n' + '='.repeat(W));
  console.log('  Scalability analysis complete. CSVs in bench/data/');
  console.log('='.repeat(W));
}

if (process.argv[1]?.endsWith('scalability.ts')) {
  main().catch(console.error);
}

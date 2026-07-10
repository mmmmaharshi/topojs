import { computePersistentHomology } from '../src/core/homology.ts';
import { computeCubicalHomology } from '../src/core/cubical.ts';
import {
  generateTerrain,
  generateTorus3D,
  generateSphere3D,
  generateNaturalImage,
  extractImagePatches,
  generateCoastline,
  loadMNISTDigits,
  loadIrisDataset,
} from '../src/data/realworld-datasets.ts';

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

function runMulti(fn: () => void, runs: number = 3): { mean: number; std: number } {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return meanStd(times);
}

const W = 90;

console.log('='.repeat(W));
console.log('  TopoJS — Real-World Dataset Benchmark (multi-run, mean±std)');
console.log('  Runtime: Node.js ' + process.version);
console.log('  Date: ' + new Date().toISOString().split('T')[0]);
console.log('='.repeat(W));
console.log('');

// ──── 1. Terrain heightmap — cubical persistence ────
console.log('Table 1. Digital Elevation Model (terrain) — cubical persistence');
console.log('  Fractal Brownian motion terrain. 3 runs each.');
console.log('-'.repeat(W));
console.log('  Size  |V|    |E|    |Sq|   H0deaths  H1pairs  Time');
console.log('-'.repeat(W));

for (const size of [8, 16, 32, 64]) {
  const terrain = generateTerrain(size);
  const ts = runMulti(() => computeCubicalHomology(terrain, size, size, 1), 3);
  const r = computeCubicalHomology(terrain, size, size, 1);
  const v = size * size;
  const e = size * (size - 1) * 2;
  const sq = (size - 1) * (size - 1);
  const h0 = r.pairs.filter(p => p.dim === 0).length;
  const h1 = r.pairs.filter(p => p.dim === 1).length;
  console.log(
    `  ${String(size).padStart(2)}×${String(size).padStart(2)}  ` +
    `${String(v).padStart(4)} ${String(e).padStart(5)} ${String(sq).padStart(5)}  ` +
    `${String(h0).padStart(8)} ${String(h1).padStart(8)}  ${fmt(ts).padStart(12)}`
  );
}
console.log('-'.repeat(W));
console.log('');

// ──── 2. Torus 3D scan — H1 ring detection ────
console.log('Table 2. Toroidal object (simulated 3D laser scan) — H1 ring detection');
console.log('  Points on T² with 5% Gaussian noise. Expect β₁ = 2.');
console.log('-'.repeat(W));
console.log('  n     ε      |E|      |T|     β₁   H0     Time ');
console.log('-'.repeat(W));

for (const n of [30, 50, 100, 200]) {
  for (const eps of [1.2, 1.8, 2.5]) {
    const pts = generateTorus3D(n, 2, 1, 0.05);
    const r0 = computePersistentHomology(pts, 3, eps, 2);
    if (r0.complex.numTriangles > 500_000) {
      console.log(`  ${String(n).padStart(4)} ${eps.toFixed(1).padStart(5)}  (skipped — ${r0.complex.numTriangles} tri)`);
      continue;
    }
    const ts = runMulti(() => computePersistentHomology(pts, 3, eps, 2), 3);
    const r = computePersistentHomology(pts, 3, eps, 2);
    const h1Essential = r.pairs.filter(p => p.dim === 1 && p.death < 0).length;
    const h0 = r.pairs.filter(p => p.dim === 0).length;
    console.log(
      `  ${String(n).padStart(4)} ${eps.toFixed(1).padStart(5)} ` +
      `${String(r.complex.numEdges).padStart(7)} ${String(r.complex.numTriangles).padStart(8)} ` +
      `${String(h1Essential).padStart(4)} ${String(h0).padStart(5)}  ${fmt(ts).padStart(12)}`
    );
  }
}
console.log('-'.repeat(W));
console.log('');

// ──── 3. Sphere 3D scan — H2 sphere detection ────
console.log('Table 3. Spherical object (simulated 3D scan) — H2 sphere detection');
console.log('  Points on S² with 3% noise. Expect β₂ = 1 at right threshold.');
console.log('-'.repeat(W));
console.log('  n     ε      |E|     |T|     |Tet|   H0    H1    H2    Time');
console.log('-'.repeat(W));

for (const n of [30, 50]) {
  const pts = generateSphere3D(n, 1, 0.03);
  for (const eps of [0.8, 1.2]) {
    const r0 = computePersistentHomology(pts, 3, eps, 3);
    if (r0.complex.numTriangles > 500_000) {
      console.log(`  ${String(n).padStart(4)} ${eps.toFixed(1).padStart(5)}  (skipped — ${r0.complex.numTriangles} tri)`);
      continue;
    }
    const ts = runMulti(() => computePersistentHomology(pts, 3, eps, 3), 3);
    const r = computePersistentHomology(pts, 3, eps, 3);
    const h0 = r.pairs.filter(p => p.dim === 0).length;
    const h1Tot = r.pairs.filter(p => p.dim === 1).length;
    const h2Ess = r.pairs.filter(p => p.dim === 2 && p.death < 0).length;
    console.log(
      `  ${String(n).padStart(4)} ${eps.toFixed(1).padStart(5)} ` +
      `${String(r.complex.numEdges).padStart(6)} ${String(r.complex.numTriangles).padStart(7)} ` +
      `${String(r.complex.numTetrahedra).padStart(7)}  ` +
      `${String(h0).padStart(4)} ${String(h1Tot).padStart(4)} ${String(h2Ess).padStart(4)}  ${fmt(ts).padStart(12)}`
    );
  }
}
console.log('-'.repeat(W));
console.log('');

// ──── 4. Natural image patches — classic TDA benchmark ────
console.log('Table 4. Natural image patches (3×3 from terrain photograph)');
console.log('  High-contrast 3×3 patches → 9-D point cloud. Classic TDA benchmark.');
console.log('-'.repeat(W));
console.log('  Patches  ε       |E|     |T|     H0   H1-ess  Time');
console.log('-'.repeat(W));

const imgPatches64 = generateNaturalImage(64);
const patches64 = extractImagePatches(imgPatches64, 64, 50);
const nPatches = patches64.length / 9;
const idxs: number[] = [];
for (let i = 0; i < nPatches && i < 100; i++) idxs.push(i);
const sampled = new Float64Array(idxs.length * 9);
for (let i = 0; i < idxs.length; i++) {
  for (let d = 0; d < 9; d++) sampled[i * 9 + d] = patches64[idxs[i]! * 9 + d]!;
}
for (const eps of [40, 55, 70]) {
  const ts = runMulti(() => computePersistentHomology(sampled, 9, eps, 2), 3);
  const r = computePersistentHomology(sampled, 9, eps, 2);
  const h0 = r.pairs.filter(p => p.dim === 0).length;
  const h1Ess = r.pairs.filter(p => p.dim === 1 && p.death < 0).length;
  console.log(
    `  ${String(idxs.length).padStart(5)}  ${eps.toFixed(0).padStart(5)}  ` +
    `${String(r.complex.numEdges).padStart(7)} ${String(r.complex.numTriangles).padStart(7)}  ` +
    `${String(h0).padStart(4)} ${String(h1Ess).padStart(7)}  ${fmt(ts).padStart(12)}`
  );
}
console.log('-'.repeat(W));
console.log('');

// ──── 5. Coastline / river meander GPS track ────
console.log('Table 5. River meander (simulated GPS track) — 2D point cloud');
console.log('  A meandering river embedded in 2D. Persistent loops = oxbow bends.');
console.log('-'.repeat(W));
console.log('  n     ε      |E|     |T|     H0    β₁-ess  Time');
console.log('-'.repeat(W));

for (const n of [50, 100, 200]) {
  const coast = generateCoastline(n);
  for (const eps of [0.3, 0.5, 0.8]) {
    const ts = runMulti(() => computePersistentHomology(coast, 2, eps, 2), 3);
    const r = computePersistentHomology(coast, 2, eps, 2);
    const h0 = r.pairs.filter(p => p.dim === 0).length;
    const h1Ess = r.pairs.filter(p => p.dim === 1 && p.death < 0).length;
    console.log(
      `  ${String(n).padStart(4)} ${eps.toFixed(1).padStart(5)} ` +
      `${String(r.complex.numEdges).padStart(7)} ${String(r.complex.numTriangles).padStart(7)} ` +
      `${String(h0).padStart(5)} ${String(h1Ess).padStart(7)}  ${fmt(ts).padStart(12)}`
    );
  }
}
console.log('-'.repeat(W));
console.log('');

// ──── 6. MNIST handwritten digits — cubical persistence ────
console.log('Table 6. MNIST handwritten digits (real data) — cubical persistence');
console.log('  10 digits from MNIST test set, 28×28 grayscale images.');
console.log('-'.repeat(W));
console.log('  Digit  H0deaths  H1-(0pers)  H1-ess  Time');
console.log('-'.repeat(W));

const mnistDigits = loadMNISTDigits();
for (const digit of mnistDigits) {
  const ts = runMulti(() => computeCubicalHomology(digit.pixels, 28, 28, 1), 3);
  const r = computeCubicalHomology(digit.pixels, 28, 28, 1);
  const h0 = r.pairs.filter(p => p.dim === 0).length;
  const h1Zero = r.pairs.filter(p => p.dim === 1 && p.death - p.birth < 1e-10).length;
  const h1Ess = r.pairs.filter(p => p.dim === 1 && p.death < 0).length;
  console.log(
    `  ${String(digit.label).padStart(3)}   ` +
    `${String(h0).padStart(8)} ${String(h1Zero).padStart(10)} ${String(h1Ess).padStart(7)}  ${fmt(ts).padStart(12)}`
  );
}
console.log('-'.repeat(W));
console.log('');

// ──── 7. Iris flower dataset — 4D Rips persistence ────
console.log('Table 7. Iris flower measurements (real data from UCI) — 4D Rips');
console.log('  150 samples × 4 dimensions. Expect 3 natural clusters in H0-H1.');
console.log('-'.repeat(W));
console.log('  ε      |E|      |T|     H0   H1-ess  H1-finite  Time');
console.log('-'.repeat(W));

const iris = loadIrisDataset();
for (const eps of [0.5, 0.8, 1.0, 1.5, 2.0]) {
  const r0 = computePersistentHomology(iris, 4, eps, 2);
  if (r0.complex.numTriangles > 500_000) {
    console.log(`  ${eps.toFixed(1).padStart(5)}  (skipped — ${r0.complex.numTriangles} tri)`);
    continue;
  }
  const ts = runMulti(() => computePersistentHomology(iris, 4, eps, 2), 3);
  const r = computePersistentHomology(iris, 4, eps, 2);
  const h0 = r.pairs.filter(p => p.dim === 0).length;
  const h1Ess = r.pairs.filter(p => p.dim === 1 && p.death < 0).length;
  const h1Fin = r.pairs.filter(p => p.dim === 1 && p.death >= 0).length;
  console.log(
    `  ${eps.toFixed(1).padStart(5)} ` +
    `${String(r.complex.numEdges).padStart(7)} ${String(r.complex.numTriangles).padStart(8)} ` +
    `${String(h0).padStart(4)} ${String(h1Ess).padStart(7)} ${String(h1Fin).padStart(9)}  ${fmt(ts).padStart(12)}`
  );
}
console.log('-'.repeat(W));
console.log('');

console.log('='.repeat(W));
console.log('  End of real-world benchmark (7 tables, mean±std over 3 runs).');
console.log('='.repeat(W));

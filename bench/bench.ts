import { computePersistentHomology } from '../src/core/homology.ts';
import { computePairwiseDistances } from '../src/core/distance.ts';
import { buildRipsComplex } from '../src/core/complex.ts';

function circlePoints(n: number, radius: number = 1.0): Float64Array {
  const flat = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    flat[i * 2] = radius * Math.cos(a);
    flat[i * 2 + 1] = radius * Math.sin(a);
  }
  return flat;
}

function randomPoints(n: number, dims: number): Float64Array {
  const flat = new Float64Array(n * dims);
  for (let i = 0; i < n * dims; i++) flat[i] = Math.random();
  return flat;
}

function now(): number {
  return performance.now();
}

function fmt(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(1)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

console.log('TopoJS — Pure-JavaScript Persistent Homology Benchmark\n');
console.log('─'.repeat(80));

// ── Circle datasets (sparse Rips: only edges along the cycle) ──
console.log('\n1. Circle datasets (ε ≈ 1.2× chord length, adjacent edges only)\n');
console.log('  n     |E|    |T|    β₀    β₁    time');

for (const n of [10, 20, 50, 100, 200, 500, 1000]) {
  const pts = circlePoints(n);
  const chord = 2 * Math.sin(Math.PI / n);
  const maxDist = chord * 1.05;

  const t0 = now();
  const res = computePersistentHomology(pts, 2, maxDist);
  const t1 = now();

  const h0 = res.pairs.filter(p => p.dim === 0).length;
  const h1d = res.pairs.filter(p => p.dim === 1 && p.death >= 0).length;
  const h1e = res.pairs.filter(p => p.dim === 1 && p.death < 0).length;

  console.log(
    `${String(n).padStart(5)} ` +
    `${String(res.complex.numEdges).padStart(6)} ` +
    `${String(res.complex.numTriangles).padStart(6)} ` +
    `${String(h0).padStart(5)} ` +
    `${String(h1d + h1e).padStart(5)} ` +
    `${fmt(t1 - t0).padStart(10)}`
  );
}

// ── Circle datasets (larger ε: includes 2-step chords, triangle fill) ──
console.log('\n2. Circle datasets (ε ≈ 2.2× chord length, triangles appear)\n');
console.log('  n     |E|    |T|    β₀    β₁    time   note');

for (const n of [10, 20, 50, 100, 200, 500]) {
  const pts = circlePoints(n);
  const chord = 2 * Math.sin(Math.PI / n);
  const maxDist = chord * 2.2;

  const t0 = now();
  const res = computePersistentHomology(pts, 2, maxDist);
  const t1 = now();

  const h0 = res.pairs.filter(p => p.dim === 0).length;
  const h1d = res.pairs.filter(p => p.dim === 1 && p.death >= 0).length;
  const h1e = res.pairs.filter(p => p.dim === 1 && p.death < 0).length;

  console.log(
    `${String(n).padStart(5)} ` +
    `${String(res.complex.numEdges).padStart(6)} ` +
    `${String(res.complex.numTriangles).padStart(6)} ` +
    `${String(h0).padStart(5)} ` +
    `${String(h1d + h1e).padStart(5)} ` +
    `${fmt(t1 - t0).padStart(10)} ` +
    `  (β₀=1, β₁=n/2 for cycle+n-cycle)`
  );
}

// ── Random point clouds (moderate ε — sparse to moderate Rips) ──
console.log('\n3. Random point clouds (unit square, ε = 0.3, 0.6, 1.0)\n');
console.log('  n     ε      |E|      |T|     β₀   β₁   time');

for (const n of [20, 50, 100, 200]) {
  for (const eps of [0.3, 0.6]) {
    const pts = randomPoints(n, 2);

    const t0 = now();
    const res = computePersistentHomology(pts, 2, eps);
    const t1 = now();

    if (res.complex.numTriangles > 500000) continue;

    const h0 = res.pairs.filter(p => p.dim === 0).length;
    const h1d = res.pairs.filter(p => p.dim === 1 && p.death >= 0).length;
    const h1e = res.pairs.filter(p => p.dim === 1 && p.death < 0).length;

    console.log(
      `${String(n).padStart(5)} ` +
      `${eps.toFixed(2).padStart(5)} ` +
      `${String(res.complex.numEdges).padStart(8)} ` +
      `${String(res.complex.numTriangles).padStart(9)} ` +
      `${String(h0).padStart(5)} ` +
      `${String(h1d + h1e).padStart(5)} ` +
      `${fmt(t1 - t0).padStart(10)}`
    );
  }
}

// ── Phase breakdown ──
console.log('\n4. Phase breakdown (circle, n=100)\n');

for (const mult of [1.05, 2.0, 3.0]) {
  const n = 100;
  const pts = circlePoints(n);
  const chord = 2 * Math.sin(Math.PI / n);
  const maxDist = chord * mult;

  const t0 = now();
  const dist = computePairwiseDistances(pts, 2, n);
  const t1 = now();

  const cx = buildRipsComplex(pts, 2, maxDist);
  const t2 = now();

  const res = computePersistentHomology(pts, 2, maxDist);
  const t3 = now();

  const complexTime = t2 - t1;
  const reductionTime = t3 - t2;

  console.log(
    `  ε=${maxDist.toFixed(3)}  ` +
    `|E|=${String(cx.edges.length).padStart(4)}  ` +
    `|T|=${String(cx.triangles.length).padStart(5)}  ` +
    `dist=${fmt(t1 - t0)}  ` +
    `build=${fmt(complexTime)}  ` +
    `reduce=${fmt(reductionTime)}  ` +
    `total=${fmt(t3 - t0)}`
  );
}

console.log('\n5. Phase breakdown (random, n=100)\n');

for (const eps of [0.3, 0.6, 1.0]) {
  const n = 100;
  const pts = randomPoints(n, 2);

  const t0 = now();
  const dist = computePairwiseDistances(pts, 2, n);
  const t1 = now();

  const cx = buildRipsComplex(pts, 2, eps);
  const t2 = now();

  if (cx.triangles.length > 500000) {
    console.log(`  ε=${eps.toFixed(2)}  (skipped — ${cx.triangles.length} triangles is too many)`);
    continue;
  }

  const res = computePersistentHomology(pts, 2, eps);
  const t3 = now();

  console.log(
    `  ε=${eps.toFixed(2).padStart(4)}  ` +
    `|E|=${String(cx.edges.length).padStart(4)}  ` +
    `|T|=${String(cx.triangles.length).padStart(5)}  ` +
    `dist=${fmt(t1 - t0)}  ` +
    `build=${fmt(t2 - t1)}  ` +
    `reduce=${fmt(t3 - t2)}  ` +
    `total=${fmt(t3 - t0)}`
  );
}

console.log('\n─'.repeat(80));
console.log('\nDone.');

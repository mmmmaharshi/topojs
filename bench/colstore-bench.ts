/**
 * Benchmark to measure the ColumnStore optimization impact.
 * Run: node --experimental-strip-types bench/colstore-bench.ts
 */
import { buildRipsComplex } from "../src/core/complex.ts";
import { computePersistentHomologyCohomologyFromComplex } from "../src/core/homology-cohom-implicit.ts";
import { computePersistentHomologyCohomology } from "../src/core/homology-cohom.ts";
import { computePersistentHomology } from "../src/core/homology.ts";

const pts = new Float64Array(64 * 64 * 2);
for (let y = 0; y < 64; y++) {
  for (let x = 0; x < 64; x++) {
    pts[(y * 64 + x) * 2] = x;
    pts[(y * 64 + x) * 2 + 1] = y;
  }
}

const dims = 2;
const maxDist = 4;
const maxDim = 2;

console.log("Building complex...");
const complex = buildRipsComplex(pts, dims, maxDist, maxDim);
console.log(
  `  ${complex.edges.length} edges, ${complex.triangles.length} triangles`
);

function run(N: number, label: string, fn: () => void): void {
  // Warmup
  for (let i = 0; i < 2; i++) {
    fn();
  }
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;
  const min = times[0]!;
  const max = times.at(-1)!;
  console.log(
    `${label.padEnd(30)} ${median.toFixed(1).padStart(8)}ms  (${min.toFixed(1)}-${max.toFixed(1)}ms)`
  );
}

const N = 5;
console.log(`\nBenchmarking (${N} repeats after warmup):`);

// Fair comparison: each engine builds complex internally
run(N, "general (full)", () =>
  computePersistentHomology(pts, dims, maxDist, maxDim)
);
run(N, "cohomology-CSR (full)", () =>
  computePersistentHomologyCohomology(pts, dims, maxDist, maxDim)
);
run(N, "implicit (full)", () => {
  const c = buildRipsComplex(pts, dims, maxDist, maxDim);
  return computePersistentHomologyCohomologyFromComplex(c, maxDim);
});

// Reduction-only comparison (complex pre-built once)
console.log(`\nReduction-only (complex pre-built):`);
run(N, "cohomology-CSR (reduce)", () => {
  const c = buildRipsComplex(pts, dims, maxDist, maxDim);
  return computePersistentHomologyCohomologyFromComplex(c, maxDim);
});
run(N, "implicit (reduce)", () =>
  computePersistentHomologyCohomologyFromComplex(complex, maxDim)
);

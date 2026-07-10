// Export helper for bench/compare_ripser.py (docs/COMPARISON.md's Ripser
// cross-check). Reads a real-data point cloud (CSV, no header, one point
// per line, space-separated coords) and dumps topojs's own
// computePersistentHomology output + timing to JSON, so the Python script
// can compare it against Ripser on the IDENTICAL point set. Not a
// benchmark script (see bench/benchmark.ts for those) -- a plumbing
// helper for the cross-tool correctness/speed comparison only.
import { readFileSync, writeFileSync } from 'node:fs';
import { computePersistentHomology } from '../src/index.ts';

const [, , csvPath, dimsArg, maxDistArg, maxDimArg, outPath] = process.argv;
const dims = Number(dimsArg);
const maxDist = Number(maxDistArg);
const maxDim = Number(maxDimArg);

const lines = readFileSync(csvPath!, 'utf8').trim().split('\n');
const flat = new Float64Array(lines.length * dims);
lines.forEach((line, i) => {
  const parts = line.trim().split(/\s+/).map(Number);
  for (let d = 0; d < dims; d++) flat[i * dims + d] = parts[d]!;
});

const t0 = performance.now();
const result = computePersistentHomology(flat, dims, maxDist, maxDim);
const ms = performance.now() - t0;

const byDim: Record<number, { finite: number; essential: number }> = {};
for (let d = 0; d <= maxDim; d++) byDim[d] = { finite: 0, essential: 0 };
// PersistencePair convention (see src/core/h0.ts docstring): death === -1
// marks an essential (infinite) class, not Infinity.
for (const p of result.pairs) {
  if (p.death === -1) byDim[p.dim]!.essential++;
  else byDim[p.dim]!.finite++;
}

writeFileSync(
  outPath!,
  JSON.stringify({ n: lines.length, dims, maxDist, maxDim, ms, byDim, pairs: result.pairs }, null, 2),
);
console.log(`topojs: n=${lines.length} ms=${ms.toFixed(2)} byDim=${JSON.stringify(byDim)}`);

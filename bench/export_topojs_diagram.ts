// Export helper for bench/compare_ripser.py (docs/COMPARISON.md's Ripser
// cross-check). Reads a real-data point cloud (CSV, no header, one point
// per line, space-separated coords) and dumps topojs's own homology-engine
// output + timing to JSON, so the Python script can compare it against
// Ripser on the IDENTICAL point set. Not a benchmark script (see
// bench/benchmark.ts for those) -- a plumbing helper for the cross-tool
// correctness/speed comparison only.
//
// engine arg: "plain" (computePersistentHomology, the original comparison
// target) or "cohom" (computePersistentHomologyCohomology, which re-derives
// some of Ripser's own structural techniques per its docstring in
// src/index.ts -- added so the Ripser comparison can quantify how much of
// the plain engine's 16x-93x gap that acceleration actually closes, instead
// of leaving that as an unmeasured docstring claim).
import { readFileSync, writeFileSync } from 'node:fs';
import { computePersistentHomology, computePersistentHomologyCohomology } from '../src/index.ts';

const [, , csvPath, dimsArg, maxDistArg, maxDimArg, outPath, engineArg] = process.argv;
const dims = Number(dimsArg);
const maxDist = Number(maxDistArg);
const maxDim = Number(maxDimArg);
const engine = engineArg === 'cohom' ? 'cohom' : 'plain';

const lines = readFileSync(csvPath!, 'utf8').trim().split('\n');
const flat = new Float64Array(lines.length * dims);
lines.forEach((line, i) => {
  const parts = line.trim().split(/\s+/).map(Number);
  for (let d = 0; d < dims; d++) flat[i * dims + d] = parts[d]!;
});

const compute = engine === 'cohom' ? computePersistentHomologyCohomology : computePersistentHomology;
const t0 = performance.now();
const result = compute(flat, dims, maxDist, maxDim);
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
  JSON.stringify({ n: lines.length, dims, maxDist, maxDim, engine, ms, byDim, pairs: result.pairs }, null, 2),
);
console.log(`topojs[${engine}]: n=${lines.length} ms=${ms.toFixed(2)} byDim=${JSON.stringify(byDim)}`);

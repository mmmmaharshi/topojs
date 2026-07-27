// Export helper for bench/compare_ripser.py (see README.md's "Against
// Ripser" section for the cross-check this feeds). Reads a real-data point
// cloud (CSV, no header, one point
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
import { readFileSync, writeFileSync } from "node:fs";

import { computePersistentHomologyCohomology } from "../src/core/homology-cohom.ts";
import { computePersistentHomologyImplicit } from "../src/core/homology-implicit.ts";
import { computePersistentHomology } from "../src/index.ts";

const csvPath = process.argv[2]!;
const dimsArg = process.argv[3]!;
const maxDistArg = process.argv[4]!;
const maxDimArg = process.argv[5]!;
const outPath = process.argv[6]!;
const engineArg = process.argv[7]!;
const dims = Number(dimsArg);
const maxDist = Number(maxDistArg);
const maxDim = Number(maxDimArg);

const lines = readFileSync(csvPath!, "utf-8").trim().split("\n");
const flat = new Float64Array(lines.length * dims);
lines.forEach((line, i) => {
  const parts = line.trim().split(/\s+/u).map(Number);
  for (let d = 0; d < dims; d++) {
    flat[i * dims + d] = parts[d]!;
  }
});

let compute: typeof computePersistentHomology;
let engine: string;
if (engineArg === "cohom") {
  compute = computePersistentHomologyCohomology;
  engine = "cohom";
} else if (engineArg === "impl") {
  compute = computePersistentHomologyImplicit;
  engine = "impl";
} else {
  compute = computePersistentHomology;
  engine = "plain";
}
const t0 = performance.now();
const result = compute(flat, dims, maxDist, maxDim);
const ms = performance.now() - t0;

const byDim: Record<number, { essential: number; finite: number }> = {};
for (let d = 0; d <= maxDim; d++) {
  byDim[d] = { essential: 0, finite: 0 };
}
// PersistencePair convention (see src/core/h0.ts docstring): death === -1
// marks an essential (infinite) class, not Infinity.
for (const p of result.pairs) {
  if (p.death === -1) {
    byDim[p.dim]!.essential++;
  } else {
    byDim[p.dim]!.finite++;
  }
}

writeFileSync(
  outPath!,
  JSON.stringify(
    {
      byDim,
      dims,
      engine,
      maxDim,
      maxDist,
      ms,
      n: lines.length,
      pairs: result.pairs,
    },
    null,
    2
  )
);
console.log(
  `topojs[${engine}]: n=${lines.length} ms=${ms.toFixed(2)} byDim=${JSON.stringify(byDim)}`
);

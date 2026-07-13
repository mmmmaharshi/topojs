/**
 * Where exactly does the "standard" (plain) engine's H2 phase stop being
 * practical, and is it time or something structural?
 *
 * README.md's "Against Ripser" section states "H2 doesn't finish at n=400
 * in the plain engine" as a known limitation, but nowhere in this repo is
 * that boundary actually located -- is it n=350? n=390? Is it a hard wall
 * (tetrahedra enumeration blowing up combinatorially) or a soft one (still
 * finishing, just slow)? This sweeps n upward on REAL data (this IS a
 * performance/scalability characterization, so CLAUDE.md's real-data-only
 * benchmark policy applies here, unlike bench/boundary-sensitivity.ts and
 * bench/bound-tightness.ts which are correctness/bound characterizations)
 * and records wall-clock time plus realized tetrahedra count at each n,
 * stopping once a time budget is blown.
 *
 * Run: node --experimental-strip-types bench/h2-scaling.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { computePersistentHomology } from "../src/core/homology-unified.ts";

const __dirname = import.meta.dirname;

function loadCsvColumn(filename: string, valueRegex: RegExp): number[] {
  const csvPath = path.join(__dirname, "data", filename);
  const raw = readFileSync(csvPath, "utf-8").trim().split("\n").slice(1);
  return raw.map((line) => {
    const m = line.match(valueRegex);
    if (!m) {
      throw new Error(`unparseable row in ${filename}: ${line}`);
    }
    return Number(m[1]);
  });
}

function minMax(series: number[]): [number, number] {
  return [Math.min(...series), Math.max(...series)];
}

function delayEmbed2D(series: number[], lag: number): number[] {
  const [mn, mx] = minMax(series);
  const norm = (v: number) => (v - mn) / (mx - mn);
  const flat: number[] = [];
  for (let i = 0; i + lag < series.length; i++) {
    flat.push(norm(series[i]!), norm(series[i + lag]!));
  }
  return flat;
}

// Real monthly sunspot counts (SIDC/WDC-SILSO), same source + delay-embedding
// convention as bench/benchmark.ts -- reused here rather than re-derived, so
// this sweep uses the SAME real series already validated elsewhere in this repo.
const monthly = loadCsvColumn(
  "monthly-sunspots.csv",
  /^"\d{4}-\d{2}",(?<value>[\d.]+)/u
);
const LAG = 6; // matches bench/benchmark.ts's fallback lag for this series
const flatAll = delayEmbed2D(monthly, LAG);
const totalPoints = flatAll.length / 2;
console.log(
  `Loaded ${totalPoints} REAL delay-embedded points from monthly sunspot counts (SIDC/WDC-SILSO).`
);

const MAX_DIST = 0.1; // deliberately modest to keep the complex realistic, not artificially dense
const TIME_BUDGET_MS = 20_000; // stop the sweep once one n takes this long

console.log(
  `\n=== H2 SCALING: "standard" (plain) engine, maxDist=${MAX_DIST}, time budget ${TIME_BUDGET_MS}ms/step ===`
);
console.log(
  "n".padStart(6) +
    "tetrahedra".padStart(12) +
    "triangles".padStart(12) +
    "edges".padStart(10) +
    "ms".padStart(12) +
    "status".padStart(12)
);

const [sweepNsArg] = process.argv.slice(2);
const sweepNs = sweepNsArg
  ? sweepNsArg.split(",").map(Number)
  : [50, 100, 150, 200, 250, 300, 325, 350, 375, 400, 425, 450];

for (const n of sweepNs) {
  if (n > totalPoints) {
    console.log(`${String(n).padStart(6)}  skipped -- not enough real data`);
    continue;
  }
  const pts = new Float64Array(flatAll.slice(0, n * 2));
  const start = performance.now();
  let status = "ok";
  let numTetrahedra = -1;
  let numTriangles = -1;
  let numEdges = -1;
  try {
    const result = computePersistentHomology(pts, 2, {
      engine: "standard",
      maxDim: 3, // 3 = tetrahedra construction = H2 (see repo's maxDim convention note)
      maxDist: MAX_DIST,
    });
    ({ numTetrahedra, numTriangles, numEdges } = result.complex);
  } catch (error) {
    status = `ERROR: ${(error as Error).message}`;
  }
  const ms = performance.now() - start;
  if (ms > TIME_BUDGET_MS) {
    status = "BUDGET EXCEEDED";
  }
  console.log(
    String(n).padStart(6) +
      String(numTetrahedra).padStart(12) +
      String(numTriangles).padStart(12) +
      String(numEdges).padStart(10) +
      ms.toFixed(1).padStart(12) +
      status.padStart(16)
  );
  if (ms > TIME_BUDGET_MS) {
    console.log(
      `\nSTOPPED sweep at n=${n}: exceeded ${TIME_BUDGET_MS}ms time budget. This is a SOFT (time) wall,`
    );
    console.log(
      "not a hard crash -- the computation would still finish given enough wall-clock time; it is simply"
    );
    console.log(
      "impractical past this point for the plain engine's explicit tetrahedra enumeration + reduction."
    );
    break;
  }
}

/**
 * How TIGHT is the landmark-subsampling bottleneck bound in practice?
 *
 * sparse-rips.ts proves d_B <= 2*coveringRadius and test/sparse-rips.test.ts
 * checks that inequality holds across hundreds of random configs -- but
 * "holds" and "useful" are different claims. A bound that holds but is 50x
 * looser than the actual error is much less useful to a caller deciding
 * "is this approximation good enough for my use case" than one that's
 * 1.2x loose. Nothing in this repo currently reports HOW tight the bound
 * is, only THAT it holds. This script measures the ratio actual_dB / bound
 * across many random trials and across a real dataset (Iris) at a range of
 * landmark budgets.
 *
 * Uses synthetic random point clouds for the swept part (correctness/bound
 * characterization, not a performance claim -- see bench/boundary-
 * sensitivity.ts's header for why CLAUDE.md's real-data-only benchmark
 * policy does not apply to this kind of measurement) plus real UCI Iris
 * data for the real-dataset part.
 *
 * Run: node --experimental-strip-types bench/bound-tightness.ts
 */
import { bottleneckDistance } from "../src/core/bottleneck.ts";
import type { Points } from "../src/core/distance.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { computeSparseRipsHomology } from "../src/core/sparse-rips.ts";
import { loadIrisDataset } from "../src/data/realworld-datasets.ts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    t ^= t >>> 14;
    return (t >>> 0) / 4_294_967_296;
  };
}

function randomPoints(rng: () => number, n: number, dims: number): Points {
  const pts = new Float64Array(n * dims);
  for (let i = 0; i < pts.length; i++) {
    pts[i] = rng();
  }
  return pts;
}

function quantile(sorted: number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx]!;
}

// ── random-config sweep ─────────────────────────────────────────────────
// Mirrors test/sparse-rips.test.ts's own generous-maxDist convention (not
// the extreme-truncation regime bench/boundary-sensitivity.ts targets) --
// this measures tightness in the regime the bound is actually meant for.

const ratios: number[] = [];
const rng = mulberry32(555);
const N_TRIALS = 300;
let infiniteCount = 0;
let totalCompared = 0;

for (let trial = 0; trial < N_TRIALS; trial++) {
  const n = 12 + Math.floor(rng() * 25);
  const dims = rng() < 0.5 ? 2 : 3;
  const numLandmarks = Math.max(3, Math.floor(n * (0.3 + rng() * 0.4)));
  const maxDist = 0.3 + rng() * 0.5;
  const pts = randomPoints(rng, n, dims);

  const exact = computePersistentHomology(pts, dims, maxDist, 2);
  const approx = computeSparseRipsHomology(
    pts,
    dims,
    n,
    numLandmarks,
    maxDist,
    2
  );
  const { bottleneckBound } = approx;
  if (bottleneckBound <= 0) {
    continue;
  }

  for (const dim of [0, 1]) {
    totalCompared++;
    const db = bottleneckDistance(exact.pairs, approx.pairs, dim);
    if (db === Number.POSITIVE_INFINITY) {
      infiniteCount++;
      continue;
    }
    ratios.push(db / bottleneckBound);
  }
}

console.log(
  `NOTE: ${infiniteCount}/${totalCompared} (${((infiniteCount / totalCompared) * 100).toFixed(1)}%) comparisons ` +
    "returned db=Infinity (essential-pair-count mismatch between exact and landmark diagrams -- " +
    "excluded from the ratio stats below, same as test/sparse-rips.test.ts's own `if (db !== Infinity)` " +
    "guard, but here the exclusion RATE is reported instead of silently applied)."
);

ratios.sort((a, b) => a - b);
console.log(
  `\n=== BOUND TIGHTNESS: random-config sweep, n=${ratios.length} comparisons ===`
);
console.log(
  "ratio = actual bottleneck distance / proven bound (1.0 = bound is exactly tight, 0 = approx matches exact diagram)"
);
console.log(`  min:    ${ratios[0]?.toFixed(4) ?? "n/a"}`);
console.log(`  p25:    ${quantile(ratios, 0.25).toFixed(4)}`);
console.log(`  median: ${quantile(ratios, 0.5).toFixed(4)}`);
console.log(`  p75:    ${quantile(ratios, 0.75).toFixed(4)}`);
console.log(`  p90:    ${quantile(ratios, 0.9).toFixed(4)}`);
console.log(`  max:    ${ratios.at(-1)?.toFixed(4) ?? "n/a"}`);
const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
console.log(`  mean:   ${mean.toFixed(4)}`);
console.log(
  "(low ratio = bound is loose/conservative -- actual error is much smaller than what's guaranteed; ratio near 1 = bound is nearly achieved)"
);

// ── real-dataset sweep: Iris across a range of landmark budgets ─────────

function loadNormalizedIris(): { points: Points; n: number; dims: number } {
  const dims = 4;
  const flat = loadIrisDataset();
  const n = flat.length / dims;
  const colMin = new Float64Array(dims).fill(Number.POSITIVE_INFINITY);
  const colMax = new Float64Array(dims).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dims; d++) {
      const v = flat[i * dims + d]!;
      if (v < colMin[d]!) {
        colMin[d] = v;
      }
      if (v > colMax[d]!) {
        colMax[d] = v;
      }
    }
  }
  const norm = new Float64Array(n * dims);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dims; d++) {
      norm[i * dims + d] =
        (flat[i * dims + d]! - colMin[d]!) / (colMax[d]! - colMin[d]!);
    }
  }
  return { dims, n, points: norm };
}

console.log("\n=== BOUND TIGHTNESS: real data (UCI Iris, 150 points, R^4) ===");
console.log(
  "numLandmarks".padStart(14) +
    "coveringR".padStart(12) +
    "bound".padStart(10) +
    "actual_dB(H0)".padStart(15) +
    "ratio(H0)".padStart(11) +
    "actual_dB(H1)".padStart(15) +
    "ratio(H1)".padStart(11)
);

const { points: irisPts, n: irisN, dims: irisDims } = loadNormalizedIris();
const maxDist = 0.35;
const exactIris = computePersistentHomology(irisPts, irisDims, maxDist, 2);

for (const numLandmarks of [10, 20, 30, 50, 75, 100, 130]) {
  const approx = computeSparseRipsHomology(
    irisPts,
    irisDims,
    irisN,
    numLandmarks,
    maxDist,
    2
  );
  const { bottleneckBound, coveringRadius } = approx;
  const dbH0 = bottleneckDistance(exactIris.pairs, approx.pairs, 0);
  const dbH1 = bottleneckDistance(exactIris.pairs, approx.pairs, 1);
  const ratioH0 = bottleneckBound > 0 ? dbH0 / bottleneckBound : Number.NaN;
  const ratioH1 = bottleneckBound > 0 ? dbH1 / bottleneckBound : Number.NaN;
  console.log(
    String(numLandmarks).padStart(14) +
      coveringRadius.toFixed(4).padStart(12) +
      bottleneckBound.toFixed(4).padStart(10) +
      dbH0.toFixed(4).padStart(15) +
      (Number.isFinite(ratioH0) ? ratioH0.toFixed(3) : "n/a").padStart(11) +
      dbH1.toFixed(4).padStart(15) +
      (Number.isFinite(ratioH1) ? ratioH1.toFixed(3) : "n/a").padStart(11)
  );
}

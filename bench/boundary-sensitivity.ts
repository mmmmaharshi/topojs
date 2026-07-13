/**
 * Empirical characterization of the landmark-subsampling bottleneck bound's
 * behavior near the maxDist truncation boundary.
 *
 * WHY THIS EXISTS. sparse-rips.ts's module docstring proves
 * `d_B(Dgm(Rips(X)), Dgm(Rips(L))) <= 2 * coveringRadius` for the FULL
 * (untruncated) Rips filtration, then states an honest but UNMEASURED
 * caveat: pairs whose birth or death lands near this library's `maxDist`
 * truncation are "not covered by the bound with the same confidence ...
 * not yet proven tightly; treat pairs within ~2*lambda of maxDist as
 * lower-confidence." test/sparse-rips.test.ts's own trials keep maxDist
 * "well above typical pair values" specifically to AVOID exercising that
 * boundary region -- which means the caveat has never actually been
 * measured anywhere in this repo. This script measures it directly:
 * deliberately shrink maxDist per trial so a meaningful fraction of pairs
 * land near the truncation, then tally how often the bound is violated in
 * that regime vs. in the interior (comfortably below maxDist).
 *
 * METHOD. For each trial: sample random points, run both the exact engine
 * and computeSparseRipsHomology, measure the actual bottleneck distance per
 * dimension, and classify the trial "boundary" if the exact diagram has any
 * finite pair with death within `bound` of maxDist (the region the caveat
 * warns about) -- else "interior". Tally violation rate (db > bound + tol)
 * separately per group.
 *
 * This uses synthetic random point clouds, not real-world datasets --
 * correctly so: CLAUDE.md's real-data-only policy applies to PERFORMANCE
 * benchmark claims (bench/benchmark.ts), not to correctness/bound
 * characterization, which the existing test suite (test/sparse-rips.test.ts,
 * test/homology-*.test.ts) already does with synthetic point clouds
 * throughout, exactly because a bound/correctness claim must be checked
 * against controlled, swept configurations, not whatever real datasets
 * happen to be bundled.
 *
 * Run: node --experimental-strip-types bench/boundary-sensitivity.ts
 */
import { bottleneckDistance } from "../src/core/bottleneck.ts";
import type { Points } from "../src/core/distance.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { computeSparseRipsHomology } from "../src/core/sparse-rips.ts";

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

function randomPoints(
  rng: () => number,
  n: number,
  dims: number,
  scale = 1
): Points {
  const pts = new Float64Array(n * dims);
  for (let i = 0; i < pts.length; i++) {
    pts[i] = rng() * scale;
  }
  return pts;
}

interface TrialResult {
  group: "boundary" | "interior";
  dim: number;
  db: number;
  bound: number;
  violated: boolean;
  violationMagnitude: number;
}

const TOL = 1e-6;
const results: TrialResult[] = [];

const rng = mulberry32(777);
const N_TRIALS = 800;

for (let trial = 0; trial < N_TRIALS; trial++) {
  const n = 12 + Math.floor(rng() * 25); // 12..36
  const dims = rng() < 0.5 ? 2 : 3;
  const numLandmarks = Math.max(3, Math.floor(n * (0.15 + rng() * 0.55))); // 15%-70% of n -- wider, includes sparser landmark sets (larger bound)
  const pts = randomPoints(rng, n, dims);

  // Deliberately vary maxDist across a wide range including EXTREMELY tight
  // values (comparable to typical nearest-neighbor spacing, sometimes smaller
  // than the bound itself) so a meaningful fraction of trials land pairs
  // right at the truncation boundary -- the opposite of
  // test/sparse-rips.test.ts's deliberately-generous maxDist.
  const maxDist = 0.03 + rng() * 0.75; // 0.03..0.78, deliberately includes extreme-truncation values

  const exact = computePersistentHomology(pts, dims, maxDist, 2);
  const approx = computeSparseRipsHomology(
    pts,
    dims,
    n,
    numLandmarks,
    maxDist,
    2
  );
  const bound = approx.bottleneckBound;

  for (const dim of [0, 1]) {
    const db = bottleneckDistance(exact.pairs, approx.pairs, dim);
    if (db === Number.POSITIVE_INFINITY) {
      continue;
    }
    // A trial/dimension is "boundary" if any FINITE exact pair in this
    // dimension has death within `bound` of maxDist -- the region
    // sparse-rips.ts's caveat explicitly flags as lower-confidence.
    const nearBoundary = exact.pairs.some(
      (p) => p.dim === dim && p.death >= 0 && maxDist - p.death <= bound + TOL
    );
    const violated = db > bound + TOL;
    results.push({
      bound,
      db,
      dim,
      group: nearBoundary ? "boundary" : "interior",
      violated,
      violationMagnitude: violated ? db - bound : 0,
    });
  }
}

function summarize(group: "boundary" | "interior"): void {
  const rows = results.filter((r) => r.group === group);
  const violations = rows.filter((r) => r.violated);
  const rate = rows.length > 0 ? violations.length / rows.length : Number.NaN;
  console.log(`\n${group.toUpperCase()} group: n=${rows.length}`);
  console.log(
    `  violation rate (db > bound + ${TOL}): ${violations.length}/${rows.length} = ${(rate * 100).toFixed(2)}%`
  );
  if (violations.length > 0) {
    const mags = violations
      .map((v) => v.violationMagnitude)
      .toSorted((a, b) => a - b);
    const median = mags[Math.floor(mags.length / 2)]!;
    const max = mags.at(-1)!;
    console.log(
      `  violation magnitude (db - bound): median=${median.toFixed(4)}, max=${max.toFixed(4)}`
    );
  }
}

console.log(`=== BOUNDARY SENSITIVITY: ${N_TRIALS} trials, dims 0-1 ===`);
console.log(
  "Classifies each (trial, dim) comparison as 'boundary' (exact diagram has a finite pair"
);
console.log(
  "within `bound` of maxDist) or 'interior', then reports the bound-violation rate per group."
);
summarize("interior");
summarize("boundary");

const totalChecked = results.length;
const totalViolated = results.filter((r) => r.violated).length;
console.log(
  `\nTOTAL: ${totalViolated}/${totalChecked} = ${((totalViolated / totalChecked) * 100).toFixed(2)}% violated across both groups.`
);

// ── H2 (maxDim=3) supplementary sweep, smaller n (H2 is expensive) ────────
const h2Results: TrialResult[] = [];
const rng2 = mulberry32(888);
const N_H2_TRIALS = 120;
for (let trial = 0; trial < N_H2_TRIALS; trial++) {
  const n = 12 + Math.floor(rng2() * 13); // 12..25
  const dims = 3;
  const numLandmarks = Math.max(4, Math.floor(n * (0.2 + rng2() * 0.5)));
  const pts = randomPoints(rng2, n, dims);
  const maxDist = 0.05 + rng2() * 0.7;

  const exact = computePersistentHomology(pts, dims, maxDist, 3);
  const approx = computeSparseRipsHomology(
    pts,
    dims,
    n,
    numLandmarks,
    maxDist,
    3
  );
  const bound = approx.bottleneckBound;

  for (const dim of [0, 1, 2]) {
    const db = bottleneckDistance(exact.pairs, approx.pairs, dim);
    if (db === Number.POSITIVE_INFINITY) {
      continue;
    }
    const nearBoundary = exact.pairs.some(
      (p) => p.dim === dim && p.death >= 0 && maxDist - p.death <= bound + TOL
    );
    const violated = db > bound + TOL;
    h2Results.push({
      bound,
      db,
      dim,
      group: nearBoundary ? "boundary" : "interior",
      violated,
      violationMagnitude: violated ? db - bound : 0,
    });
  }
}

console.log(
  `\n=== BOUNDARY SENSITIVITY: ${N_H2_TRIALS} trials, dims 0-2 (H2 included) ===`
);
for (const group of ["interior", "boundary"] as const) {
  const rows = h2Results.filter((r) => r.group === group);
  const violations = rows.filter((r) => r.violated);
  console.log(
    `${group.toUpperCase()}: n=${rows.length}, violations=${violations.length} (${rows.length > 0 ? ((violations.length / rows.length) * 100).toFixed(2) : "n/a"}%)`
  );
}
const h2Total = h2Results.length;
const h2Violated = h2Results.filter((r) => r.violated).length;
console.log(
  `H2-INCLUSIVE TOTAL: ${h2Violated}/${h2Total} = ${h2Total > 0 ? ((h2Violated / h2Total) * 100).toFixed(2) : "n/a"}% violated.`
);

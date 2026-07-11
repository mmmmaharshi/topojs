import type { Points } from './distance.ts';
import type { PersistencePair } from './h0.ts';
import { computeH0Phase } from './h0.ts';
import { buildGeneralRipsComplex } from './complex-general.ts';
import type { GeneralSimplexEntry } from './complex-general.ts';
import { DenseWorkingCol } from './reduction.ts';

/** Result of {@link computePersistentHomologyGeneral}. */
export interface HomologyResultGeneral {
  /** All persistence pairs, H0 through H{maxHomologyDim} concatenated. dim can be >= 3 -- see PerDimensionPairs's `higher` bucket (src/export/persistence-diagram.ts) for how to consume that. */
  pairs: PersistencePair[];
  /** Simplex counts per dimension, index = dimension (simplexCounts[0] = n, simplexCounts[1] = |edges|, etc.). */
  simplexCounts: number[];
}

/**
 * Vietoris–Rips persistent homology to an ARBITRARY dimension H0..H{maxHomologyDim},
 * generalizing computePersistentHomology (src/core/homology.ts, hardcoded to
 * H0+H1+H2) to loop over dimension instead of unrolling three fixed phases.
 *
 * ALGORITHM: identical column-reduction persistence to homology.ts's H1/H2
 * phases, applied uniformly for j = 1..maxHomologyDim. Phase j:
 *   1. Reduces level (j+1)'s simplices as boundary-matrix columns against
 *      level j's pivots (standard DenseWorkingCol reduction, same as
 *      homology.ts's H1/H2 loops -- see that file for the base case this
 *      generalizes).
 *   2. Finite H_j pairs: level-j pivot claimed by a level-(j+1) column ->
 *      {birth: level_j.val, death: level_(j+1).val}.
 *   3. Essential H_j pairs: level-j simplices already known to be in
 *      ker(boundary_j) (computed as a BYPRODUCT of phase j-1's reduction --
 *      "nullspace_j" below) that were never claimed as a pivot in step 1.
 * H0 is the j=0 base case, computed via computeH0Phase (union-find) exactly
 * as in homology.ts -- its `cycleEdges` output IS nullspace_1 (edges in
 * ker(boundary_1)), feeding directly into phase j=1 without a separate
 * general-purpose ker(boundary_1) computation. This is not a new algorithm,
 * it's homology.ts's existing 3-phase structure rewritten as an N-phase
 * loop -- see homology.ts's docstring for the base H1/H2 case this
 * generalizes, and complex-general.ts for the complementary generalization
 * of buildRipsComplex needed to supply levels 3+.
 *
 * VALIDATION: differential-tested against computePersistentHomology itself
 * when maxHomologyDim <= 2 (must match EXACTLY -- same algorithm, same
 * complex, just looped) across many random configs, AND against a
 * closed-form ground truth for H3 (and higher): the k-skeleton of an
 * (m-1)-simplex (m mutually-adjacent points, truncated to only build
 * simplices up to dimension k < m-1) is homotopy equivalent to a wedge of
 * C(m-1, k+1) copies of S^k -- a standard combinatorial-topology fact, and
 * the exact phenomenon already noted (but not exploited) in this repo's
 * own test/rips.test.ts ("the 3-skeleton of a 5-simplex has real H3 of
 * rank 5 ... this library does not compute" -- see test/homology-general.test.ts
 * for the now-computed, now-verified case). See test/homology-general.test.ts.
 *
 * SCOPE: builds on complex-general.ts's correctness-first (not
 * performance-tuned) complex construction -- see that file's docstring for
 * the same caveat applied here. Intended for small-to-moderate n and
 * maxHomologyDim, to make dimension >= 3 homology computable at all (no
 * other engine in this repo can), not to compete with the exact H0-H2
 * engines' performance at the n they already handle well.
 *
 * @param points Flattened coordinates, length n*dims
 * @param dims Number of dimensions per point
 * @param maxDist Vietoris–Rips threshold epsilon
 * @param maxHomologyDim Highest homology dimension to compute (H0..H{this}).
 *   Internally builds simplices up to dimension maxHomologyDim+1 (see
 *   buildGeneralRipsComplex's maxSimplexDim convention).
 */
export function computePersistentHomologyGeneral(
  points: Points,
  dims: number,
  maxDist: number,
  maxHomologyDim: number,
): HomologyResultGeneral {
  if (maxHomologyDim < 0) throw new RangeError(`maxHomologyDim must be >= 0, got ${maxHomologyDim}`);
  const n = points.length / dims;

  const maxSimplexDim = Math.max(1, maxHomologyDim + 1);
  const complex = buildGeneralRipsComplex(points, dims, maxDist, maxSimplexDim);
  const { edgeLevel, higherLevels } = complex;

  const { h0Pairs, cycleEdges } = computeH0Phase(n, edgeLevel);
  const allPairs: PersistencePair[] = [...h0Pairs];

  const simplexCounts: number[] = [n, edgeLevel.length];
  for (const lvl of higherLevels) simplexCounts.push(lvl.length);

  // level accessors: dimension 1 = edgeLevel, dimension d>=2 = higherLevels[d-2].
  function levelLength(dim: number): number {
    if (dim === 1) return edgeLevel.length;
    const idx = dim - 2;
    return idx >= 0 && idx < higherLevels.length ? higherLevels[idx]!.length : 0;
  }
  function levelVal(dim: number, i: number): number {
    if (dim === 1) return edgeLevel[i]!.val;
    return higherLevels[dim - 2]![i]!.val;
  }
  function levelColumns(dim: number): GeneralSimplexEntry[] {
    // dim here is always >= 2 (columns are the level being reduced, j+1 >= 2).
    const idx = dim - 2;
    return idx >= 0 && idx < higherLevels.length ? higherLevels[idx]! : [];
  }

  let nullspace: Uint8Array = cycleEdges; // nullspace_1, from H0's union-find byproduct

  for (let j = 1; j <= maxHomologyDim; j++) {
    const pivotLen = levelLength(j);
    const columns = levelColumns(j + 1);

    const pivots = new Int32Array(pivotLen).fill(-1);
    const reduced: (Int32Array | null)[] = new Array(columns.length).fill(null);
    const nextNullspace = new Uint8Array(columns.length);
    const w = new DenseWorkingCol(pivotLen);

    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci]!;
      w.loadFromArray(col.faces);
      while (true) {
        const pivot = w.pivot();
        if (pivot < 0) {
          reduced[ci] = new Int32Array(0);
          nextNullspace[ci] = 1;
          break;
        }
        const prev = pivots[pivot]!;
        if (prev < 0) {
          pivots[pivot] = ci;
          reduced[ci] = w.toSparse();
          const pivotVal = levelVal(j, pivot);
          if (col.val > pivotVal) {
            allPairs.push({ birth: pivotVal, death: col.val, dim: j });
          }
          break;
        }
        const prevCol = reduced[prev];
        if (prevCol === null || prevCol === undefined) break;
        w.xorSparse(prevCol);
      }
    }

    for (let p = 0; p < pivotLen; p++) {
      if (nullspace[p] && pivots[p]! < 0) {
        allPairs.push({ birth: levelVal(j, p), death: -1, dim: j });
      }
    }

    nullspace = nextNullspace;
  }

  return { pairs: allPairs, simplexCounts };
}

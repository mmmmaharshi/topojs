import type { PersistencePair } from '../core/h0.ts';

/**
 * Persistence pairs grouped by dimension and finiteness.
 *
 * `higher` holds every pair with dim >= 3 (H3 and above), grouped together
 * rather than split into finite/essential like H1/H2 -- this codebase's own
 * engines never produce dim >= 3 (buildRipsComplex caps at tetrahedra/
 * 3-simplices, so the highest computable homology is H2), but
 * PersistencePair.dim is a plain `number`, not a 0|1|2 literal type, and
 * these export functions are explicitly designed for interop with external
 * tools (toGudhi's format in particular, which supports arbitrary
 * dimensions) -- a caller round-tripping externally-computed H3+ data
 * through this function deserves those pairs preserved somewhere, not
 * silently discarded with no trace. This field exists specifically so that
 * no pair is EVER dropped by this function, regardless of dim -- see the
 * "no pair left behind" invariant test in test/export.test.ts, and the
 * concrete bug this fixed: summarize()'s own `total` count used to
 * silently disagree with `h0+h1+h2` whenever dim >= 3 pairs were present,
 * because splitByDimension threw them away before summarize ever saw them
 * grouped.
 */
export interface PerDimensionPairs {
  h0: PersistencePair[];
  h1finite: PersistencePair[];
  h1essential: PersistencePair[];
  h2finite: PersistencePair[];
  h2essential: PersistencePair[];
  higher: PersistencePair[];
}

/**
 * Split a flat array of persistence pairs into per-dimension groups.
 * H₁ and H₂ are further split into finite (killed) and essential (infinite).
 * Every pair in the input appears in exactly one output group -- dim >= 3
 * pairs go into `higher` rather than being dropped (see PerDimensionPairs's
 * docstring for why this matters and the bug it fixes).
 */
export function splitByDimension(pairs: PersistencePair[]): PerDimensionPairs {
  const h0: PersistencePair[] = [];
  const h1finite: PersistencePair[] = [];
  const h1essential: PersistencePair[] = [];
  const h2finite: PersistencePair[] = [];
  const h2essential: PersistencePair[] = [];
  const higher: PersistencePair[] = [];

  for (const p of pairs) {
    if (p.dim === 0) {
      h0.push(p);
    } else if (p.dim === 1) {
      if (p.death < 0) h1essential.push(p);
      else h1finite.push(p);
    } else if (p.dim === 2) {
      if (p.death < 0) h2essential.push(p);
      else h2finite.push(p);
    } else {
      higher.push(p);
    }
  }

  return { h0, h1finite, h1essential, h2finite, h2essential, higher };
}

/** Serialize persistence pairs to Gudhi's plain-text format: one `dim birth death` line per pair (`death` is the literal string `inf` for essential pairs), preceded by a `#`-commented header. Dimension-agnostic -- every pair is included regardless of dim. */
export function toGudhi(pairs: PersistencePair[]): string {
  const lines: string[] = [];
  lines.push('# persistence pairs: dim birth death');
  lines.push(`# total pairs: ${pairs.length}`);
  for (const p of pairs) {
    const death = p.death < 0 ? 'inf' : p.death.toFixed(6);
    lines.push(`${p.dim} ${p.birth.toFixed(6)} ${death}`);
  }
  return lines.join('\n');
}

/** Serialize persistence pairs to JSON via `JSON.stringify` (2-space indent when `pretty` is true, compact otherwise). Every field of every {@link PersistencePair} is preserved as-is, including `death < 0` for essential pairs. */
export function toJSON(
  pairs: PersistencePair[],
  pretty: boolean = false,
): string {
  const space = pretty ? 2 : 0;
  return JSON.stringify(pairs, null, space);
}

/** Serialize persistence pairs to CSV with a `dim,birth,death` header. Essential pairs (`death < 0`) are written with `death` normalized to `-1`, regardless of the original negative sentinel value. Dimension-agnostic -- every pair is included regardless of dim. */
export function toCSV(pairs: PersistencePair[]): string {
  const lines: string[] = ['dim,birth,death'];
  for (const p of pairs) {
    lines.push(`${p.dim},${p.birth},${p.death < 0 ? -1 : p.death}`);
  }
  return lines.join('\n');
}

/**
 * Fixed 8-column CSV covering H0/H1/H2 only (see the header below) -- any
 * dim >= 3 pairs in the input are NOT represented in this output (the
 * fixed-width tabular schema doesn't generalize to an unknown number of
 * higher dimensions without a bigger redesign, unlike splitByDimension's
 * `higher` bucket or toCSV/toJSON/toGudhi, which are dim-agnostic and
 * preserve everything). Use toCSV or toJSON instead if the input may
 * contain dim >= 3 pairs and losing them is not acceptable.
 */
export function toDiagramCSV(
  pairs: PersistencePair[],
): string {
  const grouped = splitByDimension(pairs);
  const lines: string[] = [
    'h0_birth,h0_death,h1finite_birth,h1finite_death,h1essential_birth,h2finite_birth,h2finite_death,h2essential_birth',
  ];

  const maxLen = Math.max(
    grouped.h0.length,
    grouped.h1finite.length,
    grouped.h1essential.length,
    grouped.h2finite.length,
    grouped.h2essential.length,
  );

  for (let i = 0; i < maxLen; i++) {
    const h0b = grouped.h0[i]?.birth ?? '';
    const h0d = grouped.h0[i]?.death ?? '';
    const h1fb = grouped.h1finite[i]?.birth ?? '';
    const h1fd = grouped.h1finite[i]?.death ?? '';
    const h1eb = grouped.h1essential[i]?.birth ?? '';
    const h2fb = grouped.h2finite[i]?.birth ?? '';
    const h2fd = grouped.h2finite[i]?.death ?? '';
    const h2eb = grouped.h2essential[i]?.birth ?? '';
    lines.push(`${h0b},${h0d},${h1fb},${h1fd},${h1eb},${h2fb},${h2fd},${h2eb}`);
  }

  return lines.join('\n');
}

/** Summary statistics for a persistence diagram, returned by {@link summarize}. */
export interface DiagramStats {
  total: number;
  h0: number;
  h1: number;
  h1finite: number;
  h1essential: number;
  h2: number;
  h2finite: number;
  h2essential: number;
  /** Count of dim >= 3 pairs -- see PerDimensionPairs's `higher` field.
   *  Invariant: total === h0 + h1 + h2 + higher, always (see test/export.test.ts). */
  higher: number;
  maxDeath: number;
  minBirth: number;
}

/**
 * Compute {@link DiagramStats} for a set of persistence pairs: per-
 * dimension counts, overall max death and min birth. `total` is
 * guaranteed to equal `h0 + h1 + h2 + higher` for any input, including
 * dim >= 3 pairs (see {@link PerDimensionPairs}'s `higher` field for why
 * this invariant matters).
 */
export function summarize(pairs: PersistencePair[]): DiagramStats {
  const byDim = splitByDimension(pairs);

  let maxDeath = 0;
  let minBirth = Infinity;

  for (const p of pairs) {
    if (p.birth < minBirth) minBirth = p.birth;
    if (p.death > maxDeath && p.death >= 0) maxDeath = p.death;
  }

  return {
    total: pairs.length,
    h0: byDim.h0.length,
    h1: byDim.h1finite.length + byDim.h1essential.length,
    h1finite: byDim.h1finite.length,
    h1essential: byDim.h1essential.length,
    h2: byDim.h2finite.length + byDim.h2essential.length,
    h2finite: byDim.h2finite.length,
    h2essential: byDim.h2essential.length,
    higher: byDim.higher.length,
    maxDeath,
    minBirth: minBirth === Infinity ? 0 : minBirth,
  };
}

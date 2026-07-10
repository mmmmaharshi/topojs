import type { PersistencePair } from '../core/h0.ts';

/** Persistence pairs grouped by dimension and finiteness. */
export interface PerDimensionPairs {
  h0: PersistencePair[];
  h1finite: PersistencePair[];
  h1essential: PersistencePair[];
  h2finite: PersistencePair[];
  h2essential: PersistencePair[];
}

/**
 * Split a flat array of persistence pairs into per-dimension groups.
 * H₁ and H₂ are further split into finite (killed) and essential (infinite).
 */
export function splitByDimension(pairs: PersistencePair[]): PerDimensionPairs {
  const h0: PersistencePair[] = [];
  const h1finite: PersistencePair[] = [];
  const h1essential: PersistencePair[] = [];
  const h2finite: PersistencePair[] = [];
  const h2essential: PersistencePair[] = [];

  for (const p of pairs) {
    if (p.dim === 0) {
      h0.push(p);
    } else if (p.dim === 1) {
      if (p.death < 0) h1essential.push(p);
      else h1finite.push(p);
    } else if (p.dim === 2) {
      if (p.death < 0) h2essential.push(p);
      else h2finite.push(p);
    }
  }

  return { h0, h1finite, h1essential, h2finite, h2essential };
}

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

export function toJSON(
  pairs: PersistencePair[],
  pretty: boolean = false,
): string {
  const space = pretty ? 2 : 0;
  return JSON.stringify(pairs, null, space);
}

export function toCSV(pairs: PersistencePair[]): string {
  const lines: string[] = ['dim,birth,death'];
  for (const p of pairs) {
    lines.push(`${p.dim},${p.birth},${p.death < 0 ? -1 : p.death}`);
  }
  return lines.join('\n');
}

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

export interface DiagramStats {
  total: number;
  h0: number;
  h1: number;
  h1finite: number;
  h1essential: number;
  h2: number;
  h2finite: number;
  h2essential: number;
  maxDeath: number;
  minBirth: number;
}

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
    maxDeath,
    minBirth: minBirth === Infinity ? 0 : minBirth,
  };
}

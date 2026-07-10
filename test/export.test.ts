import { describe, it, expect } from 'vitest';
import {
  toGudhi,
  toJSON,
  toCSV,
  toDiagramCSV,
  summarize,
  splitByDimension,
} from '../src/export/persistence-diagram.ts';
import type { PersistencePair } from '../src/core/h0.ts';

const SAMPLE_PAIRS: PersistencePair[] = [
  { dim: 0, birth: 0, death: 0.5 },
  { dim: 0, birth: 0, death: -1 },
  { dim: 1, birth: 0.3, death: 0.9 },
  { dim: 1, birth: 0.4, death: -1 },
  { dim: 2, birth: 0.6, death: -1 },
];

describe('export / serialization round-trips', () => {
  it('toJSON round-trips exactly through JSON.parse', () => {
    const json = toJSON(SAMPLE_PAIRS);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(SAMPLE_PAIRS);
  });

  it('toCSV emits header + one row per pair, essential death as -1', () => {
    const csv = toCSV(SAMPLE_PAIRS);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('dim,birth,death');
    expect(lines).toHaveLength(SAMPLE_PAIRS.length + 1);
    expect(lines[2]).toBe('0,0,-1');
  });

  it('toGudhi marks essential classes as "inf"', () => {
    const g = toGudhi(SAMPLE_PAIRS);
    const infCount = (g.match(/inf/g) || []).length;
    const essentialCount = SAMPLE_PAIRS.filter(p => p.death < 0).length;
    expect(infCount).toBe(essentialCount);
  });

  it('toDiagramCSV has the expected 8-column header', () => {
    const csv = toDiagramCSV(SAMPLE_PAIRS);
    const header = csv.split('\n')[0]!;
    expect(header.split(',')).toHaveLength(8);
  });

  it('splitByDimension counts match manual filtering', () => {
    const split = splitByDimension(SAMPLE_PAIRS);
    expect(split.h0).toHaveLength(2);
    expect(split.h1finite).toHaveLength(1);
    expect(split.h1essential).toHaveLength(1);
    expect(split.h2finite).toHaveLength(0);
    expect(split.h2essential).toHaveLength(1);
  });

  it('summarize matches hand-computed statistics', () => {
    const s = summarize(SAMPLE_PAIRS);
    expect(s.total).toBe(5);
    expect(s.h0).toBe(2);
    expect(s.h1).toBe(2);
    expect(s.h2).toBe(1);
    expect(s.maxDeath).toBe(0.9); // ignores essential -1 deaths
    expect(s.minBirth).toBe(0);
  });
});

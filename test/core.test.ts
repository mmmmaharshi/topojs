import { describe, it, expect } from 'vitest';
import { computePairwiseDistances } from '../src/core/homology.ts';
import { lookupDist } from '../src/core/distance.ts';
import { UnionFind } from '../src/core/unionfind.ts';
import { generatePoints } from './helpers.ts';

describe('distance: computePairwiseDistances + lookupDist', () => {
  it('matches direct Euclidean calculation', () => {
    const pts = generatePoints([[0, 0], [3, 4], [6, 8]]);
    const dm = computePairwiseDistances(pts, 2, 3);
    expect(lookupDist(dm, 0, 1)).toBeCloseTo(5, 10);
    expect(lookupDist(dm, 0, 2)).toBeCloseTo(10, 10);
    expect(lookupDist(dm, 1, 1)).toBe(0);
    expect(lookupDist(dm, 2, 0)).toBe(lookupDist(dm, 0, 2));
  });
});

describe('unionfind', () => {
  it('union/find collapses components correctly', () => {
    const uf = new UnionFind(5);
    expect(uf.find(0)).toBe(0);
    expect(uf.find(4)).toBe(4);
    expect(uf.union(0, 1)).toBe(true);
    expect(uf.find(0)).toBe(uf.find(1));
    expect(uf.union(0, 1)).toBe(false); // already joined
    uf.union(2, 3);
    expect(uf.find(0)).not.toBe(uf.find(2));
    uf.union(1, 2);
    expect(uf.find(0)).toBe(uf.find(3));
    uf.reset();
    expect(uf.find(0)).not.toBe(uf.find(1));
  });
});

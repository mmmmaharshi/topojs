import { describe, it, expect } from 'vitest';
import { computePairwiseDistances } from '../src/core/homology.ts';
import { lookupDist } from '../src/core/distance.ts';
import { UnionFind } from '../src/core/unionfind.ts';
import { generatePoints, mulberry32 } from './helpers.ts';

describe('distance: computePairwiseDistances + lookupDist', () => {
  it('matches direct Euclidean calculation', () => {
    const pts = generatePoints([[0, 0], [3, 4], [6, 8]]);
    const dm = computePairwiseDistances(pts, 2, 3);
    expect(lookupDist(dm, 0, 1)).toBeCloseTo(5, 10);
    expect(lookupDist(dm, 0, 2)).toBeCloseTo(10, 10);
    expect(lookupDist(dm, 1, 1)).toBe(0);
    expect(lookupDist(dm, 2, 0)).toBe(lookupDist(dm, 0, 2));
  });

  it('n=0 (empty point cloud) produces an empty, well-formed distance matrix', () => {
    // Not directly exercised before -- only reached indirectly via
    // computePersistentHomology's own "empty point cloud" test, which
    // doesn't verify computePairwiseDistances's own output shape.
    const dm = computePairwiseDistances(new Float64Array(0), 2, 0);
    expect(dm.n).toBe(0);
    expect(dm.data.length).toBe(0);
    expect(dm.rowStart.length).toBe(0);
  });

  it('n=1 (single point) produces a matrix with no pairwise entries', () => {
    const pts = generatePoints([[3, 4]]);
    const dm = computePairwiseDistances(pts, 2, 1);
    expect(dm.n).toBe(1);
    expect(dm.data.length).toBe(0); // n*(n-1)/2 = 0
    expect(lookupDist(dm, 0, 0)).toBe(0); // i===j short-circuit, doesn't touch dm.data
  });

  it('lookupDist is symmetric for every pair in a larger cloud', () => {
    const rng = mulberry32(2026);
    const n = 12;
    const pts = new Float64Array(n * 3);
    for (let i = 0; i < n * 3; i++) pts[i] = rng() * 10;
    const dm = computePairwiseDistances(pts, 3, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        expect(lookupDist(dm, i, j)).toBeCloseTo(lookupDist(dm, j, i), 12);
      }
    }
  });

  it('distances are non-negative and satisfy the triangle inequality', () => {
    const rng = mulberry32(77);
    const n = 10;
    const pts = new Float64Array(n * 2);
    for (let i = 0; i < n * 2; i++) pts[i] = rng() * 5;
    const dm = computePairwiseDistances(pts, 2, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        expect(lookupDist(dm, i, j)).toBeGreaterThanOrEqual(0);
        for (let k = 0; k < n; k++) {
          expect(lookupDist(dm, i, k)).toBeLessThanOrEqual(
            lookupDist(dm, i, j) + lookupDist(dm, j, k) + 1e-10,
          );
        }
      }
    }
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

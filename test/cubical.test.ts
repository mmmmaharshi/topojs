import { describe, it, expect } from 'vitest';
import { computeCubicalHomology } from '../src/core/cubical.ts';
import { mulberry32, countByDim } from './helpers.ts';

describe('cubical persistence', () => {
  it('3x3 all-zero image -> 8 H0 merges, 0 essential H1', () => {
    const pix = new Float64Array(9);
    const res = computeCubicalHomology(pix, 3, 3);
    expect(res.dims).toEqual({ height: 3, width: 3 });
    expect(countByDim(res.pairs, 0)).toBe(8);
    expect(res.pairs.filter(p => p.dim === 1 && p.death < 0)).toHaveLength(0);
  });

  it('2x2 checkerboard', () => {
    const pix = new Float64Array([0, 1, 1, 0]);
    const res = computeCubicalHomology(pix, 2, 2);
    expect(countByDim(res.pairs, 0)).toBe(3);
    expect(res.pairs.filter(p => p.dim === 1 && p.death < 0)).toHaveLength(0);
  });

  it('single hot center pixel produces pairs without error', () => {
    const pix = new Float64Array(9);
    pix[4] = 10;
    const res = computeCubicalHomology(pix, 3, 3, 1);
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(countByDim(res.pairs, 0)).toBe(8);
  });

  it('1x1 image (0 edges, 0 squares) does not crash', () => {
    const pix = new Float64Array([0.5]);
    const res = computeCubicalHomology(pix, 1, 1);
    expect(res.dims).toEqual({ height: 1, width: 1 });
    expect(res.pairs).toHaveLength(0);
  });

  it('non-square grid (4x9) does not crash, dims preserved', () => {
    const rng = mulberry32(99);
    const pix = new Float64Array(4 * 9);
    for (let i = 0; i < pix.length; i++) pix[i] = rng();
    const res = computeCubicalHomology(pix, 4, 9, 1);
    expect(res.dims).toEqual({ height: 4, width: 9 });
    expect(res.pairs.length).toBeGreaterThan(0);
  });

  it('maxDim=0 suppresses H1 even though squares exist', () => {
    const pix = new Float64Array([0, 1, 1, 0]); // same checkerboard, which has a square
    const res = computeCubicalHomology(pix, 2, 2, 0);
    expect(countByDim(res.pairs, 1)).toBe(0);
  });

  it('seeded random 10x10 smoke test', () => {
    const rng = mulberry32(123);
    const pix = new Float64Array(100);
    for (let i = 0; i < 100; i++) pix[i] = rng();
    const res = computeCubicalHomology(pix, 10, 10);
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(res.dims).toEqual({ height: 10, width: 10 });
  });
});

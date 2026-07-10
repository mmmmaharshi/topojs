import { describe, it, expect } from 'vitest';
import { DenseWorkingCol, xorSparse } from '../src/core/reduction.ts';

/**
 * DenseWorkingCol is the bit-vector column primitive every homology engine
 * in this repo builds on (computePersistentHomology, computePersistentHomologyFast,
 * computePersistentHomologyCohomology, computeCubicalHomology, IncrementalH1
 * all import it directly). Before this file, it had ZERO direct tests --
 * only indirect coverage through full homology computations, where a bug
 * here could easily be masked by compensating errors elsewhere (or simply
 * never exercised, e.g. the 32-bit word-boundary case, which only matters
 * once a column has 33+ possible edge indices -- something a differential
 * test against a ground-truth engine wouldn't specifically target).
 */
describe('DenseWorkingCol', () => {
  it('starts empty: pivot() is -1, toSparse() is empty', () => {
    const col = new DenseWorkingCol(10);
    expect(col.pivot()).toBe(-1);
    expect(Array.from(col.toSparse())).toEqual([]);
  });

  it('loadFromNumbers sets exactly the given bits, pivot returns the highest', () => {
    const col = new DenseWorkingCol(10);
    col.loadFromNumbers([2, 5, 7]);
    expect(col.pivot()).toBe(7);
    expect(Array.from(col.toSparse())).toEqual([2, 5, 7]);
  });

  it('loadFromArray behaves identically to loadFromNumbers for the same indices', () => {
    const a = new DenseWorkingCol(10);
    const b = new DenseWorkingCol(10);
    a.loadFromNumbers([1, 4, 9]);
    b.loadFromArray(new Int32Array([1, 4, 9]));
    expect(Array.from(a.toSparse())).toEqual(Array.from(b.toSparse()));
    expect(a.pivot()).toBe(b.pivot());
  });

  it('loadFromNumbers/loadFromArray clear prior state (not additive)', () => {
    const col = new DenseWorkingCol(10);
    col.loadFromNumbers([1, 2, 3]);
    col.loadFromNumbers([8]); // should REPLACE, not merge with [1,2,3]
    expect(Array.from(col.toSparse())).toEqual([8]);
  });

  it('clear() zeroes all bits', () => {
    const col = new DenseWorkingCol(10);
    col.loadFromNumbers([1, 2, 3]);
    col.clear();
    expect(col.pivot()).toBe(-1);
    expect(Array.from(col.toSparse())).toEqual([]);
  });

  it('xorSparse toggles bits: symmetric difference semantics', () => {
    const col = new DenseWorkingCol(10);
    col.loadFromNumbers([1, 2, 3]);
    col.xorSparse(new Int32Array([2, 3, 4])); // shared {2,3} cancel, {1} and {4} survive
    expect(Array.from(col.toSparse())).toEqual([1, 4]);
  });

  it('xorSparse with an empty array is a no-op', () => {
    const col = new DenseWorkingCol(10);
    col.loadFromNumbers([1, 2, 3]);
    col.xorSparse(new Int32Array([]));
    expect(Array.from(col.toSparse())).toEqual([1, 2, 3]);
  });

  it('xorSparse-ing the same column into itself empties it (self-cancellation)', () => {
    const col = new DenseWorkingCol(10);
    col.loadFromNumbers([1, 2, 3]);
    const snapshot = col.toSparse();
    col.xorSparse(snapshot);
    expect(Array.from(col.toSparse())).toEqual([]);
    expect(col.pivot()).toBe(-1);
  });

  it('repeated xorSparse of the same operand toggles on/off (not idempotent-clamped)', () => {
    const col = new DenseWorkingCol(10);
    col.loadFromNumbers([5]);
    const op = new Int32Array([5, 6]);
    col.xorSparse(op); // {5}^{5,6} = {6}
    expect(Array.from(col.toSparse())).toEqual([6]);
    col.xorSparse(op); // {6}^{5,6} = {5}
    expect(Array.from(col.toSparse())).toEqual([5]);
  });

  it('handles the 32-bit word boundary correctly (bit 31 vs bit 32, same word vs next word)', () => {
    // words = ceil(numEdges/32). With numEdges=64, indices 0-31 are word 0,
    // 32-63 are word 1 -- exercise both a same-word pair and a cross-word
    // pair, which pivot()'s per-word clz32 scan and toSparse()'s per-word
    // bit-extraction loop both have to get right at the boundary.
    const col = new DenseWorkingCol(64);
    col.loadFromNumbers([31, 32]); // last bit of word 0, first bit of word 1
    expect(col.pivot()).toBe(32); // highest set bit overall
    expect(Array.from(col.toSparse())).toEqual([31, 32]);
    col.xorSparse(new Int32Array([31]));
    expect(Array.from(col.toSparse())).toEqual([32]);
    expect(col.pivot()).toBe(32);
  });

  it('pivot() correctly skips fully-zero high words to find a lower set bit', () => {
    // 3 words (numEdges=96): only a bit in word 0 is set, word 1 and word 2
    // are entirely zero. pivot()'s descending word scan must not stop early
    // or misreport -1 just because the top words are empty.
    const col = new DenseWorkingCol(96);
    col.loadFromNumbers([5]);
    expect(col.pivot()).toBe(5);
  });

  it('toSparse() output is sorted ascending (word-major, bit-minor)', () => {
    const col = new DenseWorkingCol(70);
    col.loadFromNumbers([65, 3, 40, 0, 33]);
    const sparse = Array.from(col.toSparse());
    expect(sparse).toEqual([0, 3, 33, 40, 65]);
  });

  it('handles the largest valid index (numEdges-1) without overflow', () => {
    const col = new DenseWorkingCol(33); // words = ceil(33/32) = 2, valid indices 0..32
    col.loadFromNumbers([32]);
    expect(col.pivot()).toBe(32);
    expect(Array.from(col.toSparse())).toEqual([32]);
  });

  it('a fresh instance and one just clear()ed behave identically (no residual scratch state)', () => {
    // DenseWorkingCol reuses a preallocated scratch buffer across toSparse()
    // calls (see class docstring) -- confirm that reuse never leaks stale
    // entries from a previous, larger load.
    const col = new DenseWorkingCol(20);
    col.loadFromNumbers([1, 2, 3, 4, 5, 6, 7, 8]); // populate scratch with 8 entries
    col.clear();
    col.loadFromNumbers([9]); // now only 1 entry -- scratch must not still report 8
    expect(Array.from(col.toSparse())).toEqual([9]);
  });
});

describe('xorSparse (standalone sorted-array symmetric difference)', () => {
  it('computes symmetric difference of two sorted arrays', () => {
    const a = new Int32Array([1, 2, 3, 5]);
    const b = new Int32Array([2, 3, 4]);
    expect(Array.from(xorSparse(a, b))).toEqual([1, 4, 5]);
  });

  it('is its own inverse: xorSparse(xorSparse(a,b), b) recovers a', () => {
    const a = new Int32Array([1, 4, 7, 9]);
    const b = new Int32Array([2, 4, 6, 9, 10]);
    const once = xorSparse(a, b);
    const twice = xorSparse(once, b);
    expect(Array.from(twice)).toEqual(Array.from(a));
  });

  it('empty inputs behave as identity', () => {
    const a = new Int32Array([1, 2, 3]);
    const empty = new Int32Array([]);
    expect(Array.from(xorSparse(a, empty))).toEqual([1, 2, 3]);
    expect(Array.from(xorSparse(empty, a))).toEqual([1, 2, 3]);
    expect(Array.from(xorSparse(empty, empty))).toEqual([]);
  });

  it('identical arrays cancel completely', () => {
    const a = new Int32Array([2, 4, 6]);
    expect(Array.from(xorSparse(a, a))).toEqual([]);
  });

  it('result stays sorted for interleaved inputs', () => {
    const a = new Int32Array([1, 3, 5, 7, 9]);
    const b = new Int32Array([0, 2, 4, 6, 8]);
    // fully disjoint, interleaved -- result should be the merge of both, sorted
    expect(Array.from(xorSparse(a, b))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

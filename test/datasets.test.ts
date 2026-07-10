import { describe, it, expect } from 'vitest';
import { computePersistentHomology } from '../src/core/homology.ts';
import { computeCubicalHomology } from '../src/core/cubical.ts';
import { loadMNISTDigits, loadIrisDataset } from '../src/data/realworld-datasets.ts';

describe('real-world datasets', () => {
  it('MNIST — 10 digits load, cubical homology runs on digit 0', () => {
    const digits = loadMNISTDigits();
    expect(digits).toHaveLength(10);
    expect(digits[0]!.pixels).toHaveLength(784);
    expect(digits[0]!.label).toBe(7);
    const r = computeCubicalHomology(digits[3]!.pixels, 28, 28, 1);
    expect(r.pairs.length).toBeGreaterThan(0);
    expect(r.dims).toEqual({ height: 28, width: 28 });
  });

  it('Iris — 150x4 loads, Rips persistence runs', () => {
    const iris = loadIrisDataset();
    expect(iris).toHaveLength(150 * 4);
    const r = computePersistentHomology(iris, 4, 1.0, 2);
    expect(r.pairs.length).toBeGreaterThan(0);
    expect(r.complex.numVertices).toBe(150);
  });
});

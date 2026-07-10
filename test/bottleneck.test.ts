import { describe, it, expect } from 'vitest';
import { bottleneckDistance } from '../src/core/homology.ts';
import type { PersistencePair } from '../src/core/h0.ts';

describe('bottleneck distance', () => {
  it('distance between a diagram and itself is 0', () => {
    const d: PersistencePair[] = [
      { dim: 0, birth: 0, death: 1 },
      { dim: 0, birth: 0, death: 2 },
    ];
    expect(bottleneckDistance(d, d, 0)).toBe(0);
  });

  it('both diagrams empty in a dimension -> distance 0', () => {
    const d: PersistencePair[] = [{ dim: 1, birth: 0, death: 1 }];
    expect(bottleneckDistance(d, d, 0)).toBe(0);
  });

  it('one empty, one non-empty -> distance is Infinity', () => {
    const a: PersistencePair[] = [{ dim: 0, birth: 0, death: 1 }];
    const b: PersistencePair[] = [];
    expect(bottleneckDistance(a, b, 0)).toBe(Infinity);
  });

  it('single-point diagrams differing by delta -> distance ~= delta', () => {
    const delta = 0.1;
    const a: PersistencePair[] = [{ dim: 0, birth: 0, death: 1 }];
    const b: PersistencePair[] = [{ dim: 0, birth: 0, death: 1 + delta }];
    const dist = bottleneckDistance(a, b, 0, 1e6, 1e-9);
    expect(dist).toBeCloseTo(delta, 5);
  });

  it('distance is symmetric', () => {
    const a: PersistencePair[] = [
      { dim: 0, birth: 0, death: 1 },
      { dim: 0, birth: 0, death: 3 },
    ];
    const b: PersistencePair[] = [
      { dim: 0, birth: 0, death: 1.2 },
      { dim: 0, birth: 0, death: 2.5 },
    ];
    const ab = bottleneckDistance(a, b, 0);
    const ba = bottleneckDistance(b, a, 0);
    expect(ab).toBeCloseTo(ba, 5);
  });
});

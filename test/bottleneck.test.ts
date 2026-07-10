import { describe, it, expect } from 'vitest';
import { bottleneckDistance } from '../src/core/homology.ts';
import { mulberry32 } from './helpers.ts';
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

  it('only compares pairs in the requested dimension (dim filter does not cross-contaminate)', () => {
    const a: PersistencePair[] = [
      { dim: 0, birth: 0, death: 1 },
      { dim: 1, birth: 0, death: 100 }, // wildly different -- must NOT affect dim=0 result
    ];
    const b: PersistencePair[] = [
      { dim: 0, birth: 0, death: 1 },
      { dim: 1, birth: 0, death: 0.001 },
    ];
    expect(bottleneckDistance(a, b, 0)).toBe(0);
  });

  it('triangle inequality holds across random diagram triples (property-based)', () => {
    // d(A,C) <= d(A,B) + d(B,C) is a required metric axiom for any correct
    // bottleneck-distance implementation. The existing tests only checked
    // symmetry and a couple of hand-picked pairs -- this generalizes across
    // many random diagram triples, which is a much stronger correctness
    // signal for a DFS-based bipartite-matching + binary-search algorithm
    // like this one (an off-by-one in the matching or search bounds is more
    // likely to show up as a triangle-inequality violation on SOME random
    // triple than to be caught by two fixed examples).
    const rng = mulberry32(20260710);
    const randomDiagram = (n: number): PersistencePair[] => {
      const pairs: PersistencePair[] = [];
      for (let i = 0; i < n; i++) {
        const birth = rng() * 5;
        const death = birth + rng() * 5; // death >= birth, as any real diagram requires
        pairs.push({ dim: 0, birth, death });
      }
      return pairs;
    };
    for (let trial = 0; trial < 15; trial++) {
      const A = randomDiagram(1 + Math.floor(rng() * 4));
      const B = randomDiagram(1 + Math.floor(rng() * 4));
      const C = randomDiagram(1 + Math.floor(rng() * 4));
      const dAB = bottleneckDistance(A, B, 0);
      const dBC = bottleneckDistance(B, C, 0);
      const dAC = bottleneckDistance(A, C, 0);
      // Small numerical slack for the binary search's tolerance (default 1e-6).
      expect(dAC, `trial ${trial}`).toBeLessThanOrEqual(dAB + dBC + 1e-4);
    }
  });

  describe('essential (infinite-persistence) pairs -- documented scope limitation', () => {
    // bottleneckDistance's own docstring says it matches "finite persistence
    // pairs" -- it filters `p.death >= 0` before doing anything else, so
    // essential (death=-1) classes are silently EXCLUDED from the
    // comparison entirely, not matched to each other or penalized. This was
    // previously untested: there was no test anywhere that exercised this
    // function with an essential pair in the input at all. That's a real
    // gap for a metric that claims to compare "persistence diagrams" (which,
    // in the standard definition, can and often do contain essential
    // classes) -- a caller comparing two diagrams that differ ONLY by an
    // essential class (e.g. "does this loop persist forever or not") would
    // get distance 0, i.e. "identical," which is topologically misleading.
    // These tests lock in and document the CURRENT behavior explicitly
    // (so it can't silently change) rather than silently accepting it as
    // correct -- fixing it to properly account for essential classes (e.g.
    // treating differing essential counts as Infinity, matching essential-
    // to-essential by birth only) is flagged here as real follow-up work,
    // not resolved by this test.

    it('essential pairs are invisible to the comparison: two essential-only diagrams "match" at distance 0', () => {
      const a: PersistencePair[] = [{ dim: 0, birth: 0, death: -1 }];
      const b: PersistencePair[] = [{ dim: 0, birth: 5, death: -1 }]; // very different birth, still "matches"
      expect(bottleneckDistance(a, b, 0)).toBe(0);
    });

    it('a diagram with ONLY an essential class looks identical to a completely empty diagram', () => {
      // This is the sharpest illustration of the gap: "this loop never dies"
      // vs. "there is no loop at all" are very different topological
      // statements, but both currently filter down to an empty finite-pair
      // list and compare as distance 0.
      const withEssential: PersistencePair[] = [{ dim: 0, birth: 0, death: -1 }];
      const empty: PersistencePair[] = [];
      expect(bottleneckDistance(withEssential, empty, 0)).toBe(0);
    });

    it('essential pairs do not affect the distance even when finite pairs also differ', () => {
      const a: PersistencePair[] = [
        { dim: 0, birth: 0, death: 1 },
        { dim: 0, birth: 0, death: -1 }, // essential -- should be ignored
      ];
      const b: PersistencePair[] = [{ dim: 0, birth: 0, death: 1 }]; // no essential class at all
      // Only the finite pairs are compared; both diagrams have an identical
      // single finite pair, so distance is 0 regardless of the essential
      // class present only in `a`.
      expect(bottleneckDistance(a, b, 0)).toBe(0);
    });
  });
});

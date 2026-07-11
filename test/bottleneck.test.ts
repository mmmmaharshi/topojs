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

  it('one empty, one non-empty -> distance is the non-empty point\'s distance to the diagonal (NOT Infinity)', () => {
    // This test previously asserted Infinity, locking in a real bug: the
    // standard bottleneck-distance definition explicitly allows matching
    // any point to the diagonal (that's the whole mechanism for comparing
    // diagrams of different sizes), so a single finite pair vs. a
    // completely empty diagram should match to the diagonal at cost
    // (death-birth)/2, not be treated as "infinitely different." See
    // src/core/bottleneck.ts's docstring for the full root-cause writeup
    // (this was found while investigating a separate, more serious
    // asymmetry bug -- see the 'matching correctness' describe block below).
    const a: PersistencePair[] = [{ dim: 0, birth: 0, death: 1 }];
    const b: PersistencePair[] = [];
    expect(bottleneckDistance(a, b, 0)).toBeCloseTo(0.5, 5);
    expect(bottleneckDistance(b, a, 0)).toBeCloseTo(0.5, 5); // symmetric
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

  describe('essential (infinite-persistence) pairs', () => {
    // Previously essential (death=-1) pairs were silently filtered out
    // before any comparison happened, so two diagrams differing ONLY by an
    // essential class ("this loop persists forever" vs. "there is no loop
    // at all") compared as distance 0 -- topologically misleading. Fixed:
    // essential classes can only match to OTHER essential classes (never
    // the diagonal, since their distance to any finite point is infinite),
    // so differing counts give Infinity, and matching counts get compared
    // by birth value via an optimal sorted pairing (see bottleneck.ts's
    // docstring for the full reasoning). These tests assert the FIXED
    // behavior, replacing the ones that used to lock in the gap.

    it('two essential-only diagrams with different births are now correctly distinguished', () => {
      const a: PersistencePair[] = [{ dim: 0, birth: 0, death: -1 }];
      const b: PersistencePair[] = [{ dim: 0, birth: 5, death: -1 }];
      expect(bottleneckDistance(a, b, 0)).toBeCloseTo(5, 5);
    });

    it('two essential-only diagrams with the SAME birth match at distance 0', () => {
      const a: PersistencePair[] = [{ dim: 0, birth: 3, death: -1 }];
      const b: PersistencePair[] = [{ dim: 0, birth: 3, death: -1 }];
      expect(bottleneckDistance(a, b, 0)).toBe(0);
    });

    it('a diagram with ONLY an essential class vs. a completely empty diagram is Infinity (not 0)', () => {
      // The sharpest illustration of why this matters: "this loop never
      // dies" vs. "there is no loop at all" are very different topological
      // claims. An essential class has no essential-class partner in the
      // empty diagram and (unlike a finite pair) cannot fall back to
      // matching the diagonal, so no finite-cost matching exists at all.
      const withEssential: PersistencePair[] = [{ dim: 0, birth: 0, death: -1 }];
      const empty: PersistencePair[] = [];
      expect(bottleneckDistance(withEssential, empty, 0)).toBe(Infinity);
      expect(bottleneckDistance(empty, withEssential, 0)).toBe(Infinity); // symmetric
    });

    it('differing essential COUNTS (not just births) give Infinity, even with matching finite pairs', () => {
      const a: PersistencePair[] = [
        { dim: 0, birth: 0, death: 1 },
        { dim: 0, birth: 0, death: -1 },
        { dim: 0, birth: 2, death: -1 },
      ];
      const b: PersistencePair[] = [
        { dim: 0, birth: 0, death: 1 },
        { dim: 0, birth: 0, death: -1 },
      ];
      expect(bottleneckDistance(a, b, 0)).toBe(Infinity);
    });

    it('matching essential counts are paired optimally by SORTED birth value, not input order', () => {
      // {1, 10} vs {2, 9}: sorted pairing (1<->2, 10<->9) gives max(1,1)=1.
      // Unsorted/input-order pairing (1<->9, 10<->2) would wrongly give
      // max(8,8)=8 -- this test would fail if the implementation pairs by
      // array position instead of by sorted value.
      const a: PersistencePair[] = [
        { dim: 0, birth: 10, death: -1 },
        { dim: 0, birth: 1, death: -1 },
      ];
      const b: PersistencePair[] = [
        { dim: 0, birth: 2, death: -1 },
        { dim: 0, birth: 9, death: -1 },
      ];
      expect(bottleneckDistance(a, b, 0)).toBeCloseTo(1, 5);
    });

    it('overall distance is the MAX of the essential subproblem and the finite subproblem, not their sum', () => {
      // Essential-pair cost here is 5 (births 0 vs 5); finite-pair cost is
      // 0.1 (a single matching pair off by 0.1). Overall should be 5 (the
      // max), not 5.1 (their sum) and not 0.1 (finite alone).
      const a: PersistencePair[] = [
        { dim: 0, birth: 0, death: 1 },
        { dim: 0, birth: 0, death: -1 },
      ];
      const b: PersistencePair[] = [
        { dim: 0, birth: 0, death: 1.1 },
        { dim: 0, birth: 5, death: -1 },
      ];
      expect(bottleneckDistance(a, b, 0)).toBeCloseTo(5, 5);
    });

    it('essential pairs in a different dimension do not affect this dimension\'s comparison', () => {
      const a: PersistencePair[] = [
        { dim: 0, birth: 0, death: 1 },
        { dim: 1, birth: 0, death: -1 },
      ];
      const b: PersistencePair[] = [{ dim: 0, birth: 0, death: 1 }]; // no dim=1 pairs at all
      expect(bottleneckDistance(a, b, 0)).toBe(0); // dim=0 only, unaffected by dim=1 essential mismatch
    });
  });

  describe('matching correctness (found a real asymmetry bug while fixing the essential-pairs gap)', () => {
    // The PREVIOUS matchesExist only verified that every point in the
    // FIRST diagram argument was matchable (to a point in the second
    // diagram or the diagonal) -- it never checked the second diagram's
    // leftover points could also reach the diagonal or a partner. This
    // silently broke the symmetry axiom of a metric whenever the two
    // diagrams had very different persistence scales. Confirmed via a
    // concrete repro before fixing (recorded here as a permanent
    // regression test), then fixed with a provably-correct construction
    // (see bottleneck.ts's docstring) and cross-validated against an
    // independent brute-force reference across thousands of random cases.

    it('regression: the exact repro that first revealed the asymmetry bug', () => {
      // Old behavior: bottleneckDistance(c,d) ~= 0.005, bottleneckDistance(d,c) ~= 50.
      // Correct: both directions = 50 (each point independently reaches
      // its OWN nearest diagonal point, since they can't reach each other).
      const c: PersistencePair[] = [{ dim: 0, birth: 0, death: 0.01 }];
      const d: PersistencePair[] = [{ dim: 0, birth: 50, death: 150 }];
      expect(bottleneckDistance(c, d, 0)).toBeCloseTo(50, 3);
      expect(bottleneckDistance(d, c, 0)).toBeCloseTo(50, 3);
    });

    it('symmetry holds across many random diagram pairs of unequal size and scale (property-based)', () => {
      const rng = mulberry32(555);
      const randomDiagram = (n: number, scale: number): PersistencePair[] => {
        const pairs: PersistencePair[] = [];
        for (let i = 0; i < n; i++) {
          const birth = rng() * scale;
          pairs.push({ dim: 0, birth, death: birth + rng() * scale });
        }
        return pairs;
      };
      for (let trial = 0; trial < 40; trial++) {
        const A = randomDiagram(1 + Math.floor(rng() * 5), 1 + rng() * 20);
        const B = randomDiagram(1 + Math.floor(rng() * 5), 1 + rng() * 20);
        const ab = bottleneckDistance(A, B, 0);
        const ba = bottleneckDistance(B, A, 0);
        expect(ab, `trial ${trial}`).toBeCloseTo(ba, 4);
      }
    });

    it('matches an independent brute-force reference across many small random diagram pairs', () => {
      // Direct differential test against a from-scratch, obviously-correct
      // (if exponential) reference: exhaustively enumerate every candidate
      // partial matching between D1 and D2, checking whether unmatched
      // points on EITHER side can reach the diagonal. This is the same
      // validation methodology used to design the fix in the first place
      // (see bottleneck.ts's docstring) -- locked in here as a permanent
      // test rather than a one-off scratch check.
      type Pt = [number, number];
      function supNorm(a: Pt, b: Pt): number {
        return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
      }
      function costToDiag(p: Pt): number {
        return Math.abs(p[1] - p[0]) / 2;
      }
      function bruteForceFeasible(D1: Pt[], D2: Pt[], eps: number): boolean {
        const n = D1.length;
        const m = D2.length;
        const usedD2 = new Array<boolean>(m).fill(false);
        function rec(i: number): boolean {
          if (i === n) {
            for (let j = 0; j < m; j++) if (!usedD2[j] && costToDiag(D2[j]!) > eps) return false;
            return true;
          }
          for (let j = 0; j < m; j++) {
            if (!usedD2[j] && supNorm(D1[i]!, D2[j]!) <= eps) {
              usedD2[j] = true;
              if (rec(i + 1)) return true;
              usedD2[j] = false;
            }
          }
          if (costToDiag(D1[i]!) <= eps) if (rec(i + 1)) return true;
          return false;
        }
        return rec(0);
      }
      function bruteForceBottleneck(D1: Pt[], D2: Pt[]): number {
        if (D1.length === 0 && D2.length === 0) return 0;
        // Candidate thresholds: every pairwise cost and every diagonal
        // cost is a candidate optimum (standard for this kind of
        // combinatorial min-max problem) -- binary search isn't needed for
        // a brute-force reference, just check candidates in sorted order.
        const candidates = new Set<number>([0]);
        for (const p of D1) candidates.add(costToDiag(p));
        for (const p of D2) candidates.add(costToDiag(p));
        for (const p of D1) for (const q of D2) candidates.add(supNorm(p, q));
        const sorted = Array.from(candidates).sort((a, b) => a - b);
        for (const eps of sorted) {
          if (bruteForceFeasible(D1, D2, eps)) return eps;
        }
        return Infinity;
      }

      const rng = mulberry32(20260711);
      for (let trial = 0; trial < 60; trial++) {
        const n = 1 + Math.floor(rng() * 4);
        const m = 1 + Math.floor(rng() * 4);
        const A: PersistencePair[] = [];
        const D1: Pt[] = [];
        for (let i = 0; i < n; i++) {
          const birth = rng() * 10;
          const death = birth + rng() * 10;
          A.push({ dim: 0, birth, death });
          D1.push([birth, death]);
        }
        const B: PersistencePair[] = [];
        const D2: Pt[] = [];
        for (let j = 0; j < m; j++) {
          const birth = rng() * 10;
          const death = birth + rng() * 10;
          B.push({ dim: 0, birth, death });
          D2.push([birth, death]);
        }
        const expected = bruteForceBottleneck(D1, D2);
        const actual = bottleneckDistance(A, B, 0, 1e6, 1e-6);
        expect(actual, `trial ${trial}`).toBeCloseTo(expected, 4);
      }
    });
  });
});

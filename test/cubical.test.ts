import { describe, it, expect } from 'vitest';
import { computeCubicalHomology } from '../src/core/cubical.ts';
import { mulberry32, countByDim } from './helpers.ts';

/**
 * Euler-Poincare sanity check for a 2D cubical complex (V vertices, E edges,
 * S squares, no higher cells): chi = V-E+S must equal b0-b1 PROVIDED H0 and
 * H1 are both fully computed (maxDim >= 1). This is the same invariant
 * test/helpers.ts's eulerCheck() applies to the Rips engine, reimplemented
 * here for the cubical grid's cell counts (V=h*w, E=h*(w-1)+(h-1)*w,
 * S=(h-1)*(w-1), all computable directly from height/width without needing
 * the engine to expose complex sizes the way computePersistentHomology does).
 */
function cubicalEulerCheck(
  pairs: { dim: number; death: number }[],
  height: number,
  width: number,
): { chiSimplicial: number; chiBetti: number; b0: number; b1: number } {
  const V = height * width;
  const E = height * (width - 1) + (height - 1) * width;
  const S = (height - 1) * (width - 1);
  const chiSimplicial = V - E + S;
  const b0 = pairs.filter(p => p.dim === 0 && p.death < 0).length;
  const b1 = pairs.filter(p => p.dim === 1 && p.death < 0).length;
  return { chiSimplicial, chiBetti: b0 - b1, b0, b1 };
}

describe('cubical persistence', () => {
  it('3x3 all-zero image -> 8 H0 merges + 1 essential H0, 0 essential H1', () => {
    const pix = new Float64Array(9);
    const res = computeCubicalHomology(pix, 3, 3);
    expect(res.dims).toEqual({ height: 3, width: 3 });
    // 9 vertices total: 8 finite merges (spanning-tree edges) + 1 essential
    // (the single surviving component) -- NOT 8. An earlier version of this
    // library never emitted the essential H0 pair at all (see BUG FIX
    // comment in src/core/cubical.ts); this assertion locks in the correct
    // count so that regression can't silently return.
    expect(countByDim(res.pairs, 0)).toBe(9);
    expect(res.pairs.filter(p => p.dim === 0 && p.death < 0)).toHaveLength(1);
    expect(res.pairs.filter(p => p.dim === 1 && p.death < 0)).toHaveLength(0);
    const ec = cubicalEulerCheck(res.pairs, 3, 3);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
  });

  it('2x2 checkerboard', () => {
    const pix = new Float64Array([0, 1, 1, 0]);
    const res = computeCubicalHomology(pix, 2, 2);
    // 4 vertices: 3 finite merges + 1 essential (not 3 -- same fix as above).
    expect(countByDim(res.pairs, 0)).toBe(4);
    expect(res.pairs.filter(p => p.dim === 0 && p.death < 0)).toHaveLength(1);
    expect(res.pairs.filter(p => p.dim === 1 && p.death < 0)).toHaveLength(0);
    const ec = cubicalEulerCheck(res.pairs, 2, 2);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
  });

  it('single hot center pixel produces pairs without error', () => {
    const pix = new Float64Array(9);
    pix[4] = 10;
    const res = computeCubicalHomology(pix, 3, 3, 1);
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(countByDim(res.pairs, 0)).toBe(9); // 8 finite + 1 essential, not 8
    expect(res.pairs.filter(p => p.dim === 1 && p.death < 0)).toHaveLength(0);
    const ec = cubicalEulerCheck(res.pairs, 3, 3);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
  });

  it('1x1 image (0 edges, 0 squares) -> exactly one essential H0 class', () => {
    // A single pixel is a single connected component that never merges with
    // anything (there's nothing else to merge with) -- it MUST be reported
    // as one essential (death=-1) H0 class, the same way a lone point is
    // handled by the Rips engine (test/core.test.ts "single point produces
    // one essential H0 class"). Previously this returned an empty pairs
    // array (the missing-essential-H0 bug, most visible at n=1 where there
    // are no finite merges to mask it) -- see src/core/cubical.ts BUG FIX.
    const pix = new Float64Array([0.5]);
    const res = computeCubicalHomology(pix, 1, 1);
    expect(res.dims).toEqual({ height: 1, width: 1 });
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toEqual({ birth: 0, death: -1, dim: 0 });
  });

  it('non-square grid (4x9) does not crash, dims preserved, Euler-Poincare holds', () => {
    const rng = mulberry32(99);
    const pix = new Float64Array(4 * 9);
    for (let i = 0; i < pix.length; i++) pix[i] = rng();
    const res = computeCubicalHomology(pix, 4, 9, 1);
    expect(res.dims).toEqual({ height: 4, width: 9 });
    expect(res.pairs.length).toBeGreaterThan(0);
    const ec = cubicalEulerCheck(res.pairs, 4, 9);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
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

  it('ring-around-a-peak (3x3, low border / high center) -> ground-truth topology, no essential H1', () => {
    // A designed ground-truth case, not a smoke test: a low-value ring
    // (value 0) surrounds a single high-value center pixel (value 10). At
    // filtration level 0, the 8-cell border ring forms a genuine transient
    // 1-cycle (8 vertices, 8 connecting edges -- one more edge than a
    // spanning tree needs). By filtration level 10, every vertex/edge/
    // square in this 3x3 grid is present, and a full 3x3 grid of unit
    // squares tiles a solid, simply-connected region (contractible, like a
    // filled square) -- so that transient loop MUST be killed by the time
    // the center's squares appear. No essential H1 class should exist.
    //
    // This exact case caught two real bugs during a test-suite review, both
    // fixed in src/core/cubical.ts (see its BUG FIX comments):
    //   1. Square-to-edge indices were computed BEFORE edges.sort() but used
    //      AFTER it, silently wiring square boundaries to the wrong edges
    //      whenever sorting actually permuted the array (any image with
    //      more than one distinct value, i.e. most real images). This
    //      specific case produced a spurious essential H1 class as a result.
    //   2. Essential H0 classes were never emitted at all (see other tests
    //      in this file).
    // Caught here via the Euler-Poincare invariant disagreeing (chi=1 vs
    // b0-b1=-1) before either fix, not by manually inspecting output --
    // exactly the kind of ground-truth check that should exist for any
    // topology engine, not just smoke tests.
    const pix = new Float64Array([0, 0, 0, 0, 10, 0, 0, 0, 0]);
    const res = computeCubicalHomology(pix, 3, 3, 1);
    const ec = cubicalEulerCheck(res.pairs, 3, 3);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
    expect(ec.b0).toBe(1); // fully connected once the center joins in
    expect(ec.b1).toBe(0); // no essential H1 -- the ring gets filled in
    // The ring's transient loop should die exactly when the center's
    // squares appear (birth=0, the ring's own value; death=10, the center's).
    const finiteH1 = res.pairs.filter(p => p.dim === 1 && p.death >= 0);
    expect(finiteH1.some(p => p.birth === 0 && p.death === 10)).toBe(true);
  });

  it('Euler-Poincare holds across many seeded random images (property-based)', () => {
    // Generalizes the single hand-picked ring case above across many random
    // configurations and shapes -- the kind of check that would have caught
    // the two bugs above immediately (any non-uniform random image exercises
    // the edges.sort() permutation), rather than relying on one designed
    // example. Mirrors the analogous randomized check for the Rips engine in
    // test/core.test.ts.
    const rng = mulberry32(20260710);
    const shapes: [number, number][] = [[2, 2], [3, 3], [3, 5], [5, 3], [4, 4], [2, 7], [6, 6]];
    for (const [h, w] of shapes) {
      for (let trial = 0; trial < 5; trial++) {
        const pix = new Float64Array(h * w);
        for (let i = 0; i < pix.length; i++) pix[i] = Math.floor(rng() * 5); // low-cardinality -> exercises ties AND real permutation
        const res = computeCubicalHomology(pix, h, w, 1);
        const ec = cubicalEulerCheck(res.pairs, h, w);
        expect(ec.chiSimplicial, `shape ${h}x${w} trial ${trial}`).toBe(ec.chiBetti);
      }
    }
  });
});

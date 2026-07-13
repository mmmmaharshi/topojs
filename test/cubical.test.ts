import { describe, it, expect } from "vitest";
import { computeCubicalHomology } from "../src/core/cubical.ts";
import { mulberry32, countByDim } from "./helpers.ts";

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
  const b0 = pairs.filter((p) => p.dim === 0 && p.death < 0).length;
  const b1 = pairs.filter((p) => p.dim === 1 && p.death < 0).length;
  return { b0, b1, chiBetti: b0 - b1, chiSimplicial };
}

describe("cubical persistence", () => {
  it("3x3 all-zero image -> 8 H0 merges + 1 essential H0, 0 essential H1", () => {
    const pix = new Float64Array(9);
    const res = computeCubicalHomology(pix, 3, 3);
    expect(res.dims).toStrictEqual({ height: 3, width: 3 });
    // 9 vertices total: 8 finite merges (spanning-tree edges) + 1 essential
    // (the single surviving component) -- NOT 8. An earlier version of this
    // library never emitted the essential H0 pair at all (see BUG FIX
    // comment in src/core/cubical.ts); this assertion locks in the correct
    // count so that regression can't silently return.
    expect(countByDim(res.pairs, 0)).toBe(9);
    expect(res.pairs.filter((p) => p.dim === 0 && p.death < 0)).toHaveLength(1);
    // Zero finite H1 pairs too, not just zero essential ones: an all-zero
    // image is entirely tied (every edge and square has val=0), which used
    // to make the H1 phase emit a spurious birth=0,death=0 pair per square
    // reduction step (see the "zero-persistence guard" fix in
    // src/core/cubical.ts) -- a bug the OLD version of this exact assertion
    // (`death < 0` only) could not have caught, since those phantom pairs
    // are finite (death=0 >= 0), not essential.
    expect(countByDim(res.pairs, 1)).toBe(0);
    const ec = cubicalEulerCheck(res.pairs, 3, 3);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
  });

  it("2x2 checkerboard", () => {
    const pix = new Float64Array([0, 1, 1, 0]);
    const res = computeCubicalHomology(pix, 2, 2);
    // 4 vertices: 3 finite merges + 1 essential (not 3 -- same fix as above).
    expect(countByDim(res.pairs, 0)).toBe(4);
    expect(res.pairs.filter((p) => p.dim === 0 && p.death < 0)).toHaveLength(1);
    expect(res.pairs.filter((p) => p.dim === 1 && p.death < 0)).toHaveLength(0);
    const ec = cubicalEulerCheck(res.pairs, 2, 2);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
  });

  it("single hot center pixel produces pairs without error", () => {
    const pix = new Float64Array(9);
    pix[4] = 10;
    const res = computeCubicalHomology(pix, 3, 3, 1);
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(countByDim(res.pairs, 0)).toBe(9); // 8 finite + 1 essential, not 8
    expect(res.pairs.filter((p) => p.dim === 1 && p.death < 0)).toHaveLength(0);
    const ec = cubicalEulerCheck(res.pairs, 3, 3);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
  });

  it("1x1 image (0 edges, 0 squares) -> exactly one essential H0 class", () => {
    // A single pixel is a single connected component that never merges with
    // anything (there's nothing else to merge with) -- it MUST be reported
    // as one essential (death=-1) H0 class, the same way a lone point is
    // handled by the Rips engine (test/core.test.ts "single point produces
    // one essential H0 class"). Previously this returned an empty pairs
    // array (the missing-essential-H0 bug, most visible at n=1 where there
    // are no finite merges to mask it) -- see src/core/cubical.ts BUG FIX.
    const pix = new Float64Array([0.5]);
    const res = computeCubicalHomology(pix, 1, 1);
    expect(res.dims).toStrictEqual({ height: 1, width: 1 });
    expect(res.pairs).toHaveLength(1);
    expect(res.pairs[0]).toStrictEqual({ birth: 0, death: -1, dim: 0 });
  });

  it("non-square grid (4x9) does not crash, dims preserved, Euler-Poincare holds", () => {
    const rng = mulberry32(99);
    const pix = new Float64Array(4 * 9);
    for (let i = 0; i < pix.length; i++) {
      pix[i] = rng();
    }
    const res = computeCubicalHomology(pix, 4, 9, 1);
    expect(res.dims).toStrictEqual({ height: 4, width: 9 });
    expect(res.pairs.length).toBeGreaterThan(0);
    const ec = cubicalEulerCheck(res.pairs, 4, 9);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
  });

  it("maxDim=0 suppresses H1 even though squares exist", () => {
    const pix = new Float64Array([0, 1, 1, 0]); // same checkerboard, which has a square
    const res = computeCubicalHomology(pix, 2, 2, 0);
    expect(countByDim(res.pairs, 1)).toBe(0);
  });

  it("seeded random 10x10 smoke test", () => {
    const rng = mulberry32(123);
    const pix = new Float64Array(100);
    for (let i = 0; i < 100; i++) {
      pix[i] = rng();
    }
    const res = computeCubicalHomology(pix, 10, 10);
    expect(res.pairs.length).toBeGreaterThan(0);
    expect(res.dims).toStrictEqual({ height: 10, width: 10 });
  });

  it("ring-around-a-peak (3x3, low border / high center) -> ground-truth topology, no essential H1", () => {
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
    const finiteH1 = res.pairs.filter((p) => p.dim === 1 && p.death >= 0);
    expect(finiteH1.some((p) => p.birth === 0 && p.death === 10)).toBeTruthy();
  });

  it("flat region produces no spurious zero-persistence H1 pairs (regression: found and fixed a real bug)", () => {
    // A 4x4 image split into two flat halves (all 0, all 5) -- both halves
    // are internally tied (val=0 within the left half's squares, val=5
    // within the right half's), which is exactly the condition that
    // triggered the missing zero-persistence guard: every square whose
    // pivot edge shares its own filtration value used to emit a phantom
    // birth===death H1 pair. Checked directly (not just via the
    // Euler-Poincare invariant, which a same-value birth/death pair
    // satisfies trivially since it doesn't change b1) -- this is the kind
    // of tie the property-based sweep below exercises via low-cardinality
    // random values, but this case pins the exact degenerate shape down as
    // a named regression test.
    const pix = new Float64Array([0, 0, 5, 5, 0, 0, 5, 5, 0, 0, 5, 5, 0, 0, 5, 5]);
    const res = computeCubicalHomology(pix, 4, 4, 1);
    const zeroPersistenceH1 = res.pairs.filter(
      (p) => p.dim === 1 && p.death >= 0 && p.death === p.birth,
    );
    expect(zeroPersistenceH1).toHaveLength(0);
    const ec = cubicalEulerCheck(res.pairs, 4, 4);
    expect(ec.chiSimplicial).toBe(ec.chiBetti);
  });

  it("no finite H1 pair ever has birth === death, across many seeded random images (property-based)", () => {
    // Generalizes the regression test above: for ANY image (not just a
    // hand-picked flat-region case), a correctly-implemented H1 phase must
    // never emit a zero-persistence pair, since a class that is born and
    // immediately killed by the same filtration value represents no
    // topological feature. Uses the same low-cardinality random-value
    // generator as the Euler-Poincare property test below (deliberately
    // tie-heavy) since ties are exactly what exercises this bug.
    const rng = mulberry32(20_260_713);
    const shapes: [number, number][] = [
      [2, 2],
      [3, 3],
      [3, 5],
      [5, 3],
      [4, 4],
      [6, 6],
    ];
    for (const [h, w] of shapes) {
      for (let trial = 0; trial < 8; trial++) {
        const pix = new Float64Array(h * w);
        for (let i = 0; i < pix.length; i++) {
          pix[i] = Math.floor(rng() * 4);
        } // very tie-heavy
        const res = computeCubicalHomology(pix, h, w, 1);
        const zeroPersistenceH1 = res.pairs.filter(
          (p) => p.dim === 1 && p.death >= 0 && p.death === p.birth,
        );
        expect(zeroPersistenceH1, `shape ${h}x${w} trial ${trial}`).toHaveLength(0);
      }
    }
  });

  it("Euler-Poincare holds across many seeded random images (property-based)", () => {
    // Generalizes the single hand-picked ring case above across many random
    // configurations and shapes -- the kind of check that would have caught
    // the two bugs above immediately (any non-uniform random image exercises
    // the edges.sort() permutation), rather than relying on one designed
    // example. Mirrors the analogous randomized check for the Rips engine in
    // test/core.test.ts.
    const rng = mulberry32(20_260_710);
    const shapes: [number, number][] = [
      [2, 2],
      [3, 3],
      [3, 5],
      [5, 3],
      [4, 4],
      [2, 7],
      [6, 6],
    ];
    for (const [h, w] of shapes) {
      for (let trial = 0; trial < 5; trial++) {
        const pix = new Float64Array(h * w);
        for (let i = 0; i < pix.length; i++) {
          pix[i] = Math.floor(rng() * 5);
        } // low-cardinality -> exercises ties AND real permutation
        const res = computeCubicalHomology(pix, h, w, 1);
        const ec = cubicalEulerCheck(res.pairs, h, w);
        expect(ec.chiSimplicial, `shape ${h}x${w} trial ${trial}`).toBe(ec.chiBetti);
      }
    }
  });
});

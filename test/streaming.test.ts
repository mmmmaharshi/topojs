/* eslint-disable unicorn/prefer-single-call */
import { describe, it, expect } from "vitest";
import { SlidingWindow } from "../src/streaming/sliding-window.ts";
import { StreamingHomology } from "../src/streaming/streaming-homology.ts";
import { summarizeForStreaming } from "../src/streaming/topological-summary.ts";
import { computePersistentHomology } from "../src/core/homology.ts";
import { mulberry32, circlePoints } from "./helpers.ts";

describe(SlidingWindow, () => {
  it("rejects invalid construction parameters", () => {
    expect(() => new SlidingWindow(0, 2)).toThrow("capacity");
    expect(() => new SlidingWindow(5, 0)).toThrow("dims");
  });

  it("accumulates points below capacity without evicting", () => {
    const w = new SlidingWindow(5, 2);
    w.push([1, 1]);
    w.push([2, 2]);
    expect(w.size).toBe(2);
    expect(w.isFull).toBeFalsy();
    expect(Array.from(w.toFlatArray())).toStrictEqual([1, 1, 2, 2]);
  });

  it("evicts oldest point once capacity is reached", () => {
    const w = new SlidingWindow(3, 1);
    w.push([1]);
    w.push([2]);
    w.push([3]);
    expect(w.isFull).toBeTruthy();
    expect(Array.from(w.toFlatArray())).toStrictEqual([1, 2, 3]);
    w.push([4]); // evicts 1
    expect(w.size).toBe(3);
    expect(Array.from(w.toFlatArray())).toStrictEqual([2, 3, 4]);
    w.push([5]); // evicts 2
    expect(Array.from(w.toFlatArray())).toStrictEqual([3, 4, 5]);
  });

  it("rejects points of the wrong dimensionality", () => {
    const w = new SlidingWindow(3, 2);
    expect(() => w.push([1, 2, 3])).toThrow("expected point of length");
    expect(() => w.push([1])).toThrow("expected point of length");
  });

  it("handles capacity=1 (every push evicts the previous point)", () => {
    const w = new SlidingWindow(1, 2);
    w.push([1, 1]);
    expect(w.isFull).toBeTruthy();
    w.push([2, 2]);
    expect(w.size).toBe(1);
    expect(Array.from(w.toFlatArray())).toStrictEqual([2, 2]);
  });
});

describe("StreamingHomology (Phase A / naive)", () => {
  it("rejects invalid construction parameters (inherited via internal SlidingWindow)", () => {
    // StreamingHomology delegates window management to SlidingWindow
    // internally (see constructor), so it inherits that class's
    // capacity/dims validation for free -- this test exists so that
    // inheritance stays true if the delegation is ever refactored away
    // (a direct test here would catch that regression; the SlidingWindow
    // tests alone would not, since they test SlidingWindow in isolation).
    expect(() => new StreamingHomology({ dims: 2, maxDist: 1, windowSize: 0 })).toThrow("capacity");
    expect(() => new StreamingHomology({ dims: 0, maxDist: 1, windowSize: 10 })).toThrow("dims");
  });

  it("returns null until minPointsToCompute is reached", () => {
    const s = new StreamingHomology({ dims: 2, maxDist: 1, minPointsToCompute: 3, windowSize: 10 });
    expect(s.push([0, 0])).toBeNull();
    expect(s.push([1, 0])).toBeNull();
    expect(s.push([0, 1])).not.toBeNull();
  });

  it("matches a fresh full recompute on the same window contents (differential test)", () => {
    // The core correctness property of the naive baseline: since it just
    // wraps computePersistentHomology on the current window, its output
    // must be byte-identical to calling computePersistentHomology directly
    // on the same point set, for every window state along a stream.
    const rng = mulberry32(2026);
    const windowSize = 8;
    const dims = 2;
    const maxDist = 0.6;
    const s = new StreamingHomology({ dims, maxDim: 2, maxDist, windowSize });

    const allPoints: number[][] = [];
    for (let i = 0; i < 30; i++) {
      const pt = [rng(), rng()];
      allPoints.push(pt);
      const update = s.push(pt);
      if (update === null) {
        continue;
      }

      // Reconstruct expected window contents directly.
      const start = Math.max(0, allPoints.length - windowSize);
      const expectedWindow = allPoints.slice(start);
      const flat = new Float64Array(expectedWindow.length * dims);
      expectedWindow.forEach((p, idx) => {
        flat[idx * dims] = p[0]!;
        flat[idx * dims + 1] = p[1]!;
      });
      const expected = computePersistentHomology(flat, dims, maxDist, 2);

      expect(update.windowSize).toBe(expectedWindow.length);
      expect(JSON.stringify(update.result.pairs)).toBe(JSON.stringify(expected.pairs));
      expect(update.result.complex).toStrictEqual(expected.complex);
    }
  });

  it("isFull flips true exactly when windowSize points have been pushed", () => {
    const s = new StreamingHomology({ dims: 2, maxDist: 5, windowSize: 4 });
    for (let i = 0; i < 3; i++) {
      s.push([i, i]);
      expect(s.isFull).toBeFalsy();
    }
    s.push([3, 3]);
    expect(s.isFull).toBeTruthy();
    expect(s.size).toBe(4);
    s.push([4, 4]); // window now slides, still full
    expect(s.isFull).toBeTruthy();
    expect(s.size).toBe(4);
  });

  it("detects a synthetic topological event: a loop entering the window", () => {
    // First fill the window with a tight noise blob (no loop). Then push a
    // 12-gon ring of points at a scale that produces a real H1 loop once
    // the ring has fully displaced the noise in the window. The streaming
    // significantH1Count summary should go from 0 (noise only) to >=1
    // (ring fully in window) -- proof-of-concept that this catches a
    // real-time "shape change" using only client-executable computation.
    const rng = mulberry32(7);
    const windowSize = 12;
    const s = new StreamingHomology({ dims: 2, maxDim: 2, maxDist: 0.6, windowSize });

    // Phase 1: fill with noise clustered near the origin (no loop possible).
    const SIGNIFICANCE = 0.05; // consistent threshold across both phases -- a real
    // dashboard would fix this once, not vary it per-check
    let lastSummaryNoise = summarizeForStreaming([]);
    for (let i = 0; i < windowSize; i++) {
      const pt = [rng() * 0.05, rng() * 0.05];
      const update = s.push(pt);
      if (update) {
        lastSummaryNoise = summarizeForStreaming(update.result.pairs, SIGNIFICANCE);
      }
    }
    expect(lastSummaryNoise.significantH1Count).toBe(0);

    // Phase 2: push a 12-gon ring (radius 1) -- once it fully occupies the
    // window (all noise points evicted), a real loop should appear.
    const ring = circlePoints(windowSize, 1);
    let lastSummaryRing = lastSummaryNoise;
    for (let i = 0; i < windowSize; i++) {
      const pt = [ring[i * 2]!, ring[i * 2 + 1]!];
      const update = s.push(pt);
      if (update) {
        lastSummaryRing = summarizeForStreaming(update.result.pairs, SIGNIFICANCE);
      }
    }
    expect(s.isFull).toBeTruthy();
    // The ring's loop is born at the chord distance (~0.518) and, at
    // maxDist=0.6, never dies within this threshold -- so it shows up as
    // an ESSENTIAL H1 class (still open), not a finite one. A real-time
    // "does a loop exist right now" signal has to check both counts.
    const noiseLoops = lastSummaryNoise.essentialH1Count + lastSummaryNoise.significantH1Count;
    const ringLoops = lastSummaryRing.essentialH1Count + lastSummaryRing.significantH1Count;
    expect(noiseLoops).toBe(0);
    expect(ringLoops).toBeGreaterThanOrEqual(1);
  });
});

describe(summarizeForStreaming, () => {
  it("ignores H0 and essential-vs-finite H1 are counted separately", () => {
    const s = summarizeForStreaming([
      { birth: 0, death: 5, dim: 0 }, // ignored
      { birth: 0, death: 0.5, dim: 1 }, // finite, persistence 0.5
      { birth: 0, death: -1, dim: 1 }, // essential
      { birth: 0, death: 1, dim: 2 }, // ignored (not H1)
    ]);
    expect(s.totalPersistenceH1).toBeCloseTo(0.5, 10);
    expect(s.maxPersistenceH1).toBeCloseTo(0.5, 10);
    expect(s.essentialH1Count).toBe(1);
    expect(s.significantH1Count).toBe(1); // threshold defaults to 0, 0.5 > 0
  });

  it("significanceThreshold filters out low-persistence noise", () => {
    const pairs = [
      { birth: 0, death: 0.01, dim: 1 },
      { birth: 0, death: 0.5, dim: 1 },
    ];
    expect(summarizeForStreaming(pairs, 0.1).significantH1Count).toBe(1);
    expect(summarizeForStreaming(pairs, 0).significantH1Count).toBe(2);
  });
});

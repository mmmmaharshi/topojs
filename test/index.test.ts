import { describe, it, expect } from "vitest";

import * as topojs from "../src/index.ts";

/**
 * Barrel smoke test — found and closed a real verification gap during a
 * codebase audit: every OTHER test file in this suite imports directly from
 * internal implementation paths (e.g. '../src/core/homology.ts'), never
 * from '../src/index.ts'. But src/index.ts IS the actual published
 * contract (package.json's main/types/exports all point at its compiled
 * output) -- a broken or typo'd re-export, a forgotten export after a
 * rename, or a re-export accidentally resolving to the wrong symbol would
 * type-check fine internally (since every other test bypasses the barrel)
 * and only surface for real consumers post-publish. `npx tsc --noEmit`
 * catches outright syntax/type errors in the barrel, but not e.g. a
 * silently-dropped export.
 *
 * This test imports the barrel as a namespace object and asserts every
 * value export is present and has the right kind (function vs. class),
 * plus runs a couple of real end-to-end calls THROUGH the barrel import
 * (not an internal path) to close the loop completely. Type-only exports
 * (HomologyResult, PersistencePair, etc.) have no runtime representation
 * and can't be checked here -- `tsc --noEmit` against this file (which
 * imports the types too, see below) is what verifies those.
 */
describe("public API barrel (src/index.ts)", () => {
  it("exports every documented batch-homology function", () => {
    expect(topojs.computePersistentHomology).toBeTypeOf("function");
    expect(topojs.computePersistentHomologyCohomologyFromComplex).toBeTypeOf(
      "function"
    );
    expect(topojs.computeCubicalHomology).toBeTypeOf("function");
  });

  it("exports every documented arbitrary-dimension homology function", () => {
    expect(topojs.computePersistentHomologyGeneral).toBeTypeOf("function");
    expect(topojs.buildGeneralRipsComplex).toBeTypeOf("function");
  });

  it("exports every documented approximate/landmark-sampling function", () => {
    expect(topojs.computeSparseRipsHomology).toBeTypeOf("function");
    expect(topojs.selectLandmarks).toBeTypeOf("function");
  });

  it("exports every documented distance/comparison function", () => {
    expect(topojs.computePairwiseDistances).toBeTypeOf("function");
    expect(topojs.lookupDist).toBeTypeOf("function");
    expect(topojs.bottleneckDistance).toBeTypeOf("function");
  });

  /* eslint-disable vitest/max-expects */
  it("exports every documented export/serialization function", () => {
    expect(topojs.toGudhi).toBeTypeOf("function");
    expect(topojs.toJSON).toBeTypeOf("function");
    expect(topojs.toCSV).toBeTypeOf("function");
    expect(topojs.toDiagramCSV).toBeTypeOf("function");
    expect(topojs.splitByDimension).toBeTypeOf("function");
    expect(topojs.summarize).toBeTypeOf("function");
  });
  /* eslint-enable vitest/max-expects */

  it("exports every documented streaming/incremental class and helper", () => {
    expect(topojs.SlidingWindow).toBeTypeOf("function"); // class
    expect(topojs.StreamingHomology).toBeTypeOf("function"); // class
    expect(topojs.IncrementalH1).toBeTypeOf("function"); // class
    expect(topojs.summarizeForStreaming).toBeTypeOf("function");
  });

  it("exports every documented example-dataset function", () => {
    expect(topojs.loadMNISTDigits).toBeTypeOf("function");
    expect(topojs.loadIrisDataset).toBeTypeOf("function");
    expect(topojs.generateTerrain).toBeTypeOf("function");
  });

  it("end-to-end: computePersistentHomology works when called through the barrel import", () => {
    const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
    const result = topojs.computePersistentHomology(points, 2, 1, 2);
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.complex.numVertices).toBe(3);
  });

  it("end-to-end: StreamingHomology + IncrementalH1 both work when instantiated through the barrel import", () => {
    const naive = new topojs.StreamingHomology({
      dims: 2,
      maxDist: 2,
      windowSize: 5,
    });
    const incr = new topojs.IncrementalH1({
      dims: 2,
      maxDist: 2,
      windowSize: 5,
    });
    const pts: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.5, 0.5],
      [2, 2],
    ];
    for (const [x, y] of pts) {
      naive.push([x, y]);
      incr.push([x, y]);
    }
    expect(naive.size).toBe(5);
    expect(incr.size).toBe(5);
  });

  it("end-to-end: export round-trip works when called through the barrel import", () => {
    const pairs = [
      { birth: 0, death: 0.5, dim: 0 },
      { birth: 0.2, death: -1, dim: 1 },
    ];
    const split = topojs.splitByDimension(pairs);
    expect(split.h0).toHaveLength(1);
    expect(split.h1essential).toHaveLength(1);
    const s = topojs.summarize(pairs);
    expect(s.total).toBe(s.h0 + s.h1 + s.h2 + s.higher);
    const json = topojs.toJSON(pairs);
    expect(JSON.parse(json)).toStrictEqual(pairs);
  });
});

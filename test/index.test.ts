import { describe, it, expect } from "vitest";

import * as topojs from "../src/index.ts";
import { samePersistencePairs } from "./helpers.ts";

const advancedCompute = topojs.advanced.computePersistentHomology;

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
    expect(topojs).not.toHaveProperty(
      "computePersistentHomologyCohomologyFromComplex"
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

  it("exports every documented persistence-vectorization function", () => {
    expect(topojs.computePersistenceLandscape).toBeTypeOf("function");
    expect(topojs.computePersistenceImage).toBeTypeOf("function");
  });

  it("exports every documented streaming/incremental class and helper", () => {
    expect(topojs.SlidingWindow).toBeTypeOf("function"); // class
    expect(topojs.StreamingHomology).toBeTypeOf("function"); // class
    expect(topojs.IncrementalH1).toBeTypeOf("function"); // class
    expect(topojs.summarizeForStreaming).toBeTypeOf("function");
  });

  it("exposes advanced controls only under the advanced namespace", () => {
    expect(topojs).not.toHaveProperty("collapseDominatedEdges");
    expect(topojs.advanced).toBeTypeOf("object");
    expect(topojs.advanced.computePersistentHomology).toBeTypeOf("function");
    expect(topojs.advanced.collapseDominatedEdges).toBeTypeOf("function");
  });

  it("rejects advanced options on the default entry point", () => {
    const points = new Float64Array([0, 0, 1, 0]);
    const engineOptions = { engine: "reduced", maxDim: 1 };
    const collapseOptions = { collapse: true, maxDim: 1 };
    expect(() =>
      topojs.computePersistentHomology(points, 2, engineOptions)
    ).toThrow(/advanced\.computePersistentHomology/u);
    expect(() =>
      topojs.computePersistentHomology(points, 2, collapseOptions)
    ).toThrow(/advanced\.computePersistentHomology/u);
  });

  it("exports generateTerrain", () => {
    expect(topojs.generateTerrain).toBeTypeOf("function");
  });

  it("advanced.computePersistentHomology accepts the legacy positional form", () => {
    const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
    const positional = advancedCompute(points, 2, 1, 2);
    const options = advancedCompute(points, 2, { maxDim: 2, maxDist: 1 });
    expect(positional.pairs).toHaveLength(options.pairs.length);
    expect(positional.complex.numEdges).toBe(options.complex.numEdges);
  });

  it("end-to-end: computePersistentHomology works when called through the barrel import", () => {
    const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
    const result = topojs.computePersistentHomology(points, 2, 1, 2);
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.complex.numVertices).toBe(3);
  });

  it("end-to-end: advanced reduced engine works when called through the barrel import (H0+H1 only, matching the standard engine)", () => {
    const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866, 0.5, 0.3]);
    const standard = topojs.computePersistentHomology(points, 2, {
      maxDim: 1,
    });
    const reduced = advancedCompute(points, 2, {
      engine: "reduced",
      maxDim: 1,
    });
    expect(reduced.complex.numVertices).toBe(standard.complex.numVertices);
    expect(reduced.pairs).toHaveLength(standard.pairs.length);
  });

  it("supports advanced collapsed reduced H1 through the unified options object", () => {
    const points = new Float64Array([1, 1, 1, 1, -1, -1, -1, 1, -1, -1, -1, 1]);
    const regular = advancedCompute(points, 3, {
      engine: "reduced",
      maxDim: 1,
      maxDist: 3,
    });
    const collapsed = advancedCompute(points, 3, {
      collapse: true,
      engine: "reduced",
      maxDim: 1,
      maxDist: 3,
    });
    expect(samePersistencePairs(collapsed.pairs, regular.pairs)).toBeTruthy();
    expect(collapsed.complex.numEdges).toBeLessThan(regular.complex.numEdges);

    const standard = advancedCompute(points, 3, {
      collapse: true,
      engine: "standard",
      maxDim: 1,
      maxDist: 3,
    });
    expect(samePersistencePairs(standard.pairs, regular.pairs)).toBeTruthy();

    const explicitlyRegular = advancedCompute(points, 3, {
      collapse: false,
      engine: "reduced",
      maxDim: 1,
      maxDist: 3,
    });
    expect(
      samePersistencePairs(explicitlyRegular.pairs, regular.pairs)
    ).toBeTruthy();

    for (const engine of [
      "auto",
      "standard",
      "cohomology",
      "implicit",
      "implicit-full",
      "fast",
    ] as const) {
      const withCollapse = advancedCompute(points, 3, {
        collapse: true,
        engine,
        maxDim: 1,
        maxDist: 3,
      });
      const withoutCollapse = advancedCompute(points, 3, {
        engine,
        maxDim: 1,
        maxDist: 3,
      });
      expect(
        samePersistencePairs(withCollapse.pairs, withoutCollapse.pairs)
      ).toBeTruthy();
    }
  });

  it("uses homology-dimension maxDim semantics across the published engines", () => {
    const loop = new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const octahedron = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    const engines = [
      "auto",
      "standard",
      "cohomology",
      "implicit",
      "implicit-full",
      "fast",
    ] as const;

    for (const engine of engines) {
      const h0 = advancedCompute(loop, 2, {
        engine,
        maxDim: 0,
        maxDist: 1.1,
      });
      expect(h0.pairs.every((pair) => pair.dim === 0)).toBeTruthy();

      const h1 = advancedCompute(loop, 2, {
        engine,
        maxDim: 1,
        maxDist: 1.1,
      });
      expect(h1.pairs.some((pair) => pair.dim === 1)).toBeTruthy();
      expect(h1.pairs.every((pair) => pair.dim <= 1)).toBeTruthy();

      const h2 = advancedCompute(octahedron, 3, {
        engine,
        maxDim: 2,
        maxDist: Math.SQRT2 + 0.01,
      });
      expect(h2.pairs.some((pair) => pair.dim === 2)).toBeTruthy();
    }
  });

  it("defaults the published interface to H0+H1+H2", () => {
    const octahedron = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    const result = topojs.computePersistentHomology(
      octahedron,
      3,
      Math.SQRT2 + 0.01
    );
    expect(result.pairs.some((pair) => pair.dim === 2)).toBeTruthy();
  });

  it("uses public maxDim semantics in the direct implicit entry point", () => {
    const loop = new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const h0 = topojs.computePersistentHomologyImplicit(loop, 2, 1.1, 0);
    expect(h0.pairs.every((pair) => pair.dim === 0)).toBeTruthy();

    const octahedron = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    const h2 = topojs.computePersistentHomologyImplicit(
      octahedron,
      3,
      Math.SQRT2 + 0.01,
      2
    );
    expect(h2.pairs.some((pair) => pair.dim === 2)).toBeTruthy();
  });

  it("uses public maxDim semantics in the sparse entry point", () => {
    const octahedron = new Float64Array([
      1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
    ]);
    const result = topojs.computeSparseRipsHomology(
      octahedron,
      3,
      6,
      6,
      Math.SQRT2 + 0.01,
      2
    );
    expect(result.pairs.some((pair) => pair.dim === 2)).toBeTruthy();
  });

  it("uses public maxDim semantics in the streaming entry point", () => {
    const octahedron = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const h0Stream = new topojs.StreamingHomology({
      dims: 3,
      maxDim: 0,
      maxDist: Math.SQRT2 + 0.01,
      windowSize: 6,
    });
    const h2Stream = new topojs.StreamingHomology({
      dims: 3,
      maxDim: 2,
      maxDist: Math.SQRT2 + 0.01,
      windowSize: 6,
    });
    let h0;
    let h2;
    for (const point of octahedron) {
      h0 = h0Stream.push(point);
      h2 = h2Stream.push(point);
    }
    expect(h0?.result.pairs.every((pair) => pair.dim === 0)).toBeTruthy();
    expect(h2?.result.pairs.some((pair) => pair.dim === 2)).toBeTruthy();
  });

  it("computePersistentHomology's engine:'reduced' option supports scope 0 and 1, and rejects scope 2", () => {
    const loop = new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const h0 = advancedCompute(loop, 2, {
      engine: "reduced",
      maxDim: 0,
      maxDist: 1.1,
    });
    expect(h0.pairs.every((pair) => pair.dim === 0)).toBeTruthy();

    const h1 = advancedCompute(loop, 2, {
      engine: "reduced",
      maxDim: 1,
      maxDist: 1.1,
    });
    expect(h1.pairs.some((pair) => pair.dim === 1)).toBeTruthy();
    expect(h1.pairs.every((pair) => pair.dim <= 1)).toBeTruthy();

    expect(() =>
      advancedCompute(loop, 2, {
        engine: "reduced",
        maxDim: 2,
        maxDist: 1.1,
      })
    ).toThrow(/only computes H0\+H1/u);
  });

  it("computePersistentHomology's engine:'reduced' option throws a clear error if maxDim>1 is requested (it has no H2 algorithm)", () => {
    const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
    expect(() => advancedCompute(points, 2, { engine: "reduced" })).toThrow(
      /only computes H0\+H1/u
    );
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

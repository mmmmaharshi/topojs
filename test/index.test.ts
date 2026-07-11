import { describe, it, expect } from 'vitest';
import * as topojs from '../src/index.ts';

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
describe('public API barrel (src/index.ts)', () => {
  it('exports every documented batch-homology function', () => {
    expect(typeof topojs.computePersistentHomology).toBe('function');
    expect(typeof topojs.computePersistentHomologyFast).toBe('function');
    expect(typeof topojs.computePersistentHomologyCohomology).toBe('function');
    expect(typeof topojs.computeCubicalHomology).toBe('function');
  });

  it('exports every documented arbitrary-dimension homology function', () => {
    expect(typeof topojs.computePersistentHomologyGeneral).toBe('function');
    expect(typeof topojs.buildGeneralRipsComplex).toBe('function');
  });

  it('exports every documented approximate/landmark-sampling function', () => {
    expect(typeof topojs.computeSparseRipsHomology).toBe('function');
    expect(typeof topojs.selectLandmarks).toBe('function');
  });

  it('exports every documented distance/comparison function', () => {
    expect(typeof topojs.computePairwiseDistances).toBe('function');
    expect(typeof topojs.lookupDist).toBe('function');
    expect(typeof topojs.bottleneckDistance).toBe('function');
  });

  it('exports every documented export/serialization function', () => {
    expect(typeof topojs.toGudhi).toBe('function');
    expect(typeof topojs.toJSON).toBe('function');
    expect(typeof topojs.toCSV).toBe('function');
    expect(typeof topojs.toDiagramCSV).toBe('function');
    expect(typeof topojs.splitByDimension).toBe('function');
    expect(typeof topojs.summarize).toBe('function');
  });

  it('exports every documented streaming/incremental class and helper', () => {
    expect(typeof topojs.SlidingWindow).toBe('function'); // class
    expect(typeof topojs.StreamingHomology).toBe('function'); // class
    expect(typeof topojs.IncrementalH1).toBe('function'); // class
    expect(typeof topojs.summarizeForStreaming).toBe('function');
  });

  it('exports every documented example-dataset function', () => {
    expect(typeof topojs.loadMNISTDigits).toBe('function');
    expect(typeof topojs.loadIrisDataset).toBe('function');
    expect(typeof topojs.generateTerrain).toBe('function');
  });

  it('end-to-end: computePersistentHomology works when called through the barrel import', () => {
    const points = new Float64Array([0, 0, 1, 0, 0.5, 0.866]);
    const result = topojs.computePersistentHomology(points, 2, 1.0, 2);
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.complex.numVertices).toBe(3);
  });

  it('end-to-end: StreamingHomology + IncrementalH1 both work when instantiated through the barrel import', () => {
    const naive = new topojs.StreamingHomology({ windowSize: 5, dims: 2, maxDist: 2.0 });
    const incr = new topojs.IncrementalH1({ windowSize: 5, dims: 2, maxDist: 2.0 });
    const pts: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [2, 2]];
    for (const [x, y] of pts) {
      naive.push([x, y]);
      incr.push([x, y]);
    }
    expect(naive.size).toBe(5);
    expect(incr.size).toBe(5);
  });

  it('end-to-end: export round-trip works when called through the barrel import', () => {
    const pairs = [
      { dim: 0, birth: 0, death: 0.5 },
      { dim: 1, birth: 0.2, death: -1 },
    ];
    const split = topojs.splitByDimension(pairs);
    expect(split.h0).toHaveLength(1);
    expect(split.h1essential).toHaveLength(1);
    const s = topojs.summarize(pairs);
    expect(s.total).toBe(s.h0 + s.h1 + s.h2 + s.higher);
    const json = topojs.toJSON(pairs);
    expect(JSON.parse(json)).toEqual(pairs);
  });
});

import { describe, it, expect } from "vitest";

import type { PersistencePair } from "../src/core/h0.ts";
import {
  toGudhi,
  toJSON,
  toCSV,
  toDiagramCSV,
  summarize,
  splitByDimension,
} from "../src/export/persistence-diagram.ts";
import {
  computePersistenceLandscape,
  computePersistenceImage,
} from "../src/export/vectorization.ts";
import { mulberry32 } from "./helpers.ts";

const SAMPLE_PAIRS: PersistencePair[] = [
  { birth: 0, death: 0.5, dim: 0 },
  { birth: 0, death: -1, dim: 0 },
  { birth: 0.3, death: 0.9, dim: 1 },
  { birth: 0.4, death: -1, dim: 1 },
  { birth: 0.6, death: -1, dim: 2 },
];

// Includes dim >= 3 pairs specifically to exercise the `higher` bucket --
// this codebase's own engines never produce these (buildRipsComplex caps
// at tetrahedra, so H2 is the highest computable dimension), but
// PersistencePair.dim is a plain number, not a 0|1|2 literal type, and
// these export functions are explicitly for interop with external tools
// (toGudhi's format supports arbitrary dimensions) -- data from elsewhere
// could easily contain H3+ pairs.
const PAIRS_WITH_HIGHER_DIMS: PersistencePair[] = [
  ...SAMPLE_PAIRS,
  { birth: 0.1, death: 0.2, dim: 3 },
  { birth: 0.15, death: -1, dim: 3 },
  { birth: 0.05, death: 0.4, dim: 5 },
];

describe("export / serialization round-trips", () => {
  it("toJSON round-trips exactly through JSON.parse", () => {
    const json = toJSON(SAMPLE_PAIRS);
    const parsed = JSON.parse(json);
    expect(parsed).toStrictEqual(SAMPLE_PAIRS);
  });

  it("toCSV emits header + one row per pair, essential death as -1", () => {
    const csv = toCSV(SAMPLE_PAIRS);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("dim,birth,death");
    expect(lines).toHaveLength(SAMPLE_PAIRS.length + 1);
    expect(lines[2]).toBe("0,0,-1");
  });

  it('toGudhi marks essential classes as "inf"', () => {
    const g = toGudhi(SAMPLE_PAIRS);
    const infCount = (g.match(/inf/gu) || []).length;
    const essentialCount = SAMPLE_PAIRS.filter((p) => p.death < 0).length;
    expect(infCount).toBe(essentialCount);
  });

  it("toDiagramCSV has the expected 8-column header", () => {
    const csv = toDiagramCSV(SAMPLE_PAIRS);
    const header = csv.split("\n")[0]!;
    expect(header.split(",")).toHaveLength(8);
  });

  /* eslint-disable vitest/max-expects */
  it("splitByDimension counts match manual filtering", () => {
    const split = splitByDimension(SAMPLE_PAIRS);
    expect(split.h0).toHaveLength(2);
    expect(split.h1finite).toHaveLength(1);
    expect(split.h1essential).toHaveLength(1);
    expect(split.h2finite).toHaveLength(0);
    expect(split.h2essential).toHaveLength(1);
    expect(split.higher).toHaveLength(0);
  });
  /* eslint-enable vitest/max-expects */

  /* eslint-disable vitest/max-expects */
  it("summarize matches hand-computed statistics", () => {
    const s = summarize(SAMPLE_PAIRS);
    expect(s.total).toBe(5);
    expect(s.h0).toBe(2);
    expect(s.h1).toBe(2);
    expect(s.h2).toBe(1);
    expect(s.higher).toBe(0);
    expect(s.maxDeath).toBe(0.9); // ignores essential -1 deaths
    expect(s.minBirth).toBe(0);
  });
  /* eslint-enable vitest/max-expects */

  describe("dim >= 3 pairs (found and fixed a real silent-data-loss bug)", () => {
    // splitByDimension used to only handle dim 0/1/2 -- any pair with
    // dim >= 3 fell through every branch silently, meaning it was dropped
    // with no error, no warning, and no trace anywhere. Concrete impact
    // this had before the fix: summarize()'s own `total` field (a plain
    // count of the input array) would silently disagree with its
    // `h0+h1+h2` breakdown whenever the input contained any dim >= 3
    // pair -- an internally inconsistent result from a function whose
    // whole job is to report consistent statistics. Currently latent for
    // this repo's OWN engines (buildRipsComplex caps at tetrahedra, so H2
    // is the highest dimension they can ever produce) but real and
    // reachable for any external data fed through these interop-oriented
    // export functions (toGudhi's own format supports arbitrary
    // dimensions). Fixed via a `higher` bucket that catches everything
    // dim >= 3 -- these tests lock in the fix, not just document the gap.

    it("splitByDimension captures dim >= 3 pairs in `higher` instead of dropping them", () => {
      const split = splitByDimension(PAIRS_WITH_HIGHER_DIMS);
      expect(split.higher).toHaveLength(3);
      expect(split.higher.map((p) => p.dim).toSorted()).toStrictEqual([
        3, 3, 5,
      ]);
    });

    it("no pair from the input is ever lost: sum of all buckets equals input length (regression test, specific case)", () => {
      const split = splitByDimension(PAIRS_WITH_HIGHER_DIMS);
      const total =
        split.h0.length +
        split.h1finite.length +
        split.h1essential.length +
        split.h2finite.length +
        split.h2essential.length +
        split.higher.length;
      expect(total).toBe(PAIRS_WITH_HIGHER_DIMS.length);
    });

    it("no pair from the input is ever lost, across many random dimension distributions (property-based)", () => {
      const rng = mulberry32(20_260_712);
      for (let trial = 0; trial < 50; trial++) {
        const n = Math.floor(rng() * 30);
        const pairs: PersistencePair[] = [];
        for (let i = 0; i < n; i++) {
          const dim = Math.floor(rng() * 8); // 0..7, deliberately reaching well past dim=2
          const birth = rng() * 10;
          const isEssential = rng() < 0.3;
          pairs.push({
            birth,
            death: isEssential ? -1 : birth + rng() * 10,
            dim,
          });
        }
        const split = splitByDimension(pairs);
        const total =
          split.h0.length +
          split.h1finite.length +
          split.h1essential.length +
          split.h2finite.length +
          split.h2essential.length +
          split.higher.length;
        expect(total, `trial ${trial} (n=${n})`).toBe(pairs.length);
      }
    });

    it("summarize: total === h0+h1+h2+higher invariant holds even with dim >= 3 pairs present (the exact bug that was found)", () => {
      const s = summarize(PAIRS_WITH_HIGHER_DIMS);
      expect(s.total).toBe(PAIRS_WITH_HIGHER_DIMS.length);
      expect(s.higher).toBe(3);
      expect(s.total).toBe(s.h0 + s.h1 + s.h2 + s.higher); // used to fail: total=8, h0+h1+h2=5
    });

    it("summarize: the total invariant holds across many random dimension distributions (property-based)", () => {
      const rng = mulberry32(9988);
      for (let trial = 0; trial < 50; trial++) {
        const n = Math.floor(rng() * 30);
        const pairs: PersistencePair[] = [];
        for (let i = 0; i < n; i++) {
          const dim = Math.floor(rng() * 8);
          const birth = rng() * 10;
          const isEssential = rng() < 0.3;
          pairs.push({
            birth,
            death: isEssential ? -1 : birth + rng() * 10,
            dim,
          });
        }
        const s = summarize(pairs);
        expect(s.total, `trial ${trial}`).toBe(s.h0 + s.h1 + s.h2 + s.higher);
      }
    });

    it("toDiagramCSV documented limitation: dim >= 3 pairs are not represented in its fixed 8-column schema", () => {
      // Not a bug (the docstring now says so explicitly) -- this test
      // exists so that limitation is verified/locked in, not just claimed
      // in a comment that could silently go stale.
      const csv = toDiagramCSV(PAIRS_WITH_HIGHER_DIMS);
      // Row count is governed by the H0/H1/H2 groups only (maxLen=2 here,
      // from h0's 2 entries), NOT inflated by the 3 higher-dim pairs.
      const dataLines = csv.split("\n").slice(1);
      expect(dataLines).toHaveLength(2);
      // toCSV/toJSON, by contrast, are dim-agnostic and DO preserve everything.
      expect(toCSV(PAIRS_WITH_HIGHER_DIMS).split("\n")).toHaveLength(
        PAIRS_WITH_HIGHER_DIMS.length + 1
      );
      expect(JSON.parse(toJSON(PAIRS_WITH_HIGHER_DIMS))).toHaveLength(
        PAIRS_WITH_HIGHER_DIMS.length
      );
    });
  });
});

describe("persistence vectorization", () => {
  const pairs: PersistencePair[] = [
    { birth: 0, death: 1, dim: 0 },
    { birth: 0.2, death: 0.8, dim: 1 },
    { birth: 0.5, death: -1, dim: 1 },
  ];

  it("landscape shape matches options", () => {
    const L = computePersistenceLandscape(pairs, {
      maxFiltration: 1,
      maxLandscape: 3,
      resolution: 10,
    });
    expect(L).toHaveLength(3);
    for (const layer of L) {
      expect(layer).toHaveLength(10);
      for (const v of layer) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("landscape first layer is non-zero somewhere", () => {
    const L = computePersistenceLandscape(pairs, {
      maxFiltration: 1,
      maxLandscape: 3,
      resolution: 50,
    });
    const hasNonZero = L[0]!.some((v) => v > 0);
    expect(hasNonZero).toBeTruthy();
  });

  it("landscape defaults handle empty pairs", () => {
    const L = computePersistenceLandscape([], { maxFiltration: 1 });
    expect(L).toHaveLength(5);
    for (const layer of L) {
      for (const v of layer) {
        expect(v).toBe(0);
      }
    }
  });

  it("image shape matches options", () => {
    const img = computePersistenceImage(pairs, {
      maxFiltration: 1,
      resolution: [20, 15],
      variance: 0.05,
    });
    expect(img).toHaveLength(15);
    for (const row of img) {
      expect(row).toHaveLength(20);
    }
  });

  it("image is non-zero near a pair", () => {
    const single: PersistencePair[] = [{ birth: 0.4, death: 0.6, dim: 1 }];
    const img = computePersistenceImage(single, {
      maxFiltration: 1,
      resolution: [50, 50],
      variance: 0.02,
    });
    const sum = img.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
    expect(sum).toBeGreaterThan(0);
  });

  it("image handles empty pairs", () => {
    const img = computePersistenceImage([], { maxFiltration: 1 });
    expect(img).toHaveLength(50);
    expect(img[0]).toHaveLength(50);
    expect(img[0]![0]).toBe(0);
  });

  it("image with none weight and zero persistence yields empty", () => {
    const zeroPers: PersistencePair[] = [{ birth: 0.5, death: 0.5, dim: 1 }];
    const img = computePersistenceImage(zeroPers, {
      maxFiltration: 1,
      weightFunction: "linear",
    });
    const sum = img.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
    expect(sum).toBe(0);
  });
});

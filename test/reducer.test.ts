import { describe, expect, it } from "vitest";

import type { PersistencePair } from "../src/core/h0.ts";
import {
  collectEssentialClasses,
  columnStoreColumnAdapter,
  denseColumnAdapter,
  reducePhase,
} from "../src/core/reducer.ts";
import { ColumnStore, DenseWorkingCol } from "../src/core/reduction.ts";

describe("reduction phase", () => {
  it("preserves pairs, nullspace, and essential classes with both column adapters", () => {
    const columns = [
      new Int32Array([0]),
      new Int32Array([0, 1]),
      new Int32Array([1, 2]),
      new Int32Array([0, 1, 2]),
    ];
    const columnValues = [1, 2, 4, 4];
    const pivotValues = [1, 2, 3, 4];
    const cycleRows = new Uint8Array([1, 1, 1, 1]);

    const run = (
      adapter:
        | ReturnType<typeof denseColumnAdapter>
        | ReturnType<typeof columnStoreColumnAdapter>
    ) => {
      const nullspace = new Uint8Array(columns.length);
      const pairs: PersistencePair[] = [];
      reducePhase({
        adapter,
        columnValue: (column) => columnValues[column]!,
        dimension: 1,
        emitPair: (pair) => pairs.push(pair),
        end: columns.length,
        filtrationOrder: "boundary",
        loadColumn: (column) => {
          adapter.working.loadFromArray(columns[column]!);
        },
        nullspace,
        pivotValue: (pivot) => pivotValues[pivot]!,
        start: 0,
        step: 1,
      });
      collectEssentialClasses(
        adapter.pivots,
        cycleRows,
        (pivot) => pivotValues[pivot]!,
        1,
        (pair) => pairs.push(pair)
      );
      return { nullspace: [...nullspace], pairs, pivots: [...adapter.pivots] };
    };

    const dense = run(
      denseColumnAdapter(
        new DenseWorkingCol(pivotValues.length),
        new Int32Array(pivotValues.length).fill(-1),
        Array.from<Int32Array | null>({ length: columns.length }).fill(null)
      )
    );
    const stored = run(
      columnStoreColumnAdapter(
        new DenseWorkingCol(pivotValues.length),
        new Int32Array(pivotValues.length).fill(-1),
        new ColumnStore(columns.length)
      )
    );

    expect(dense).toStrictEqual({
      nullspace: [0, 0, 0, 1],
      pairs: [
        { birth: 3, death: 4, dim: 1 },
        { birth: 4, death: -1, dim: 1 },
      ],
      pivots: [0, 1, 2, -1],
    });
    expect(stored).toStrictEqual(dense);
  });

  it("suppresses zero-persistence pairs", () => {
    const working = new DenseWorkingCol(1);
    const pivots = new Int32Array(1).fill(-1);
    const pairs: PersistencePair[] = [];

    reducePhase({
      adapter: denseColumnAdapter(
        working,
        pivots,
        Array.from<Int32Array | null>({ length: 2 }).fill(null)
      ),
      columnValue: () => 1,
      dimension: 1,
      emitPair: (pair) => pairs.push(pair),
      end: 2,
      filtrationOrder: "boundary",
      loadColumn: () => {
        working.loadFromArray(new Int32Array([0]));
      },
      pivotValue: () => 1,
      start: 0,
      step: 1,
    });

    expect(pairs).toStrictEqual([]);
    expect(pivots).toStrictEqual(new Int32Array([0]));
  });
});

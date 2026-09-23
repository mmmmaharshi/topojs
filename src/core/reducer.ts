import type { PersistencePair } from "./h0.ts";
import type { ColumnStore, DenseWorkingCol } from "./reduction.ts";

type FiltrationOrder = "boundary" | "coboundary";

interface DenseColumnAdapter {
  kind: "dense";
  pivots: Int32Array;
  reduced: (Int32Array | null)[];
  working: DenseWorkingCol;
}

interface ColumnStoreColumnAdapter {
  kind: "column-store";
  pivots: Int32Array;
  reduced: ColumnStore;
  working: DenseWorkingCol;
}

type ReductionColumnAdapter = DenseColumnAdapter | ColumnStoreColumnAdapter;

interface ReductionPhaseOptions {
  adapter: ReductionColumnAdapter;
  columnValue: (column: number) => number;
  dimension: number;
  emitPair: (pair: PersistencePair, column: number) => void;
  end: number;
  filtrationOrder: FiltrationOrder;
  loadColumn: (column: number) => void;
  nullspace?: Uint8Array;
  pivotIndex?: (workingPivot: number) => number;
  pivotValue: (pivot: number) => number;
  skipColumn?: (column: number) => boolean;
  start: number;
  step: 1 | -1;
}

export function denseColumnAdapter(
  working: DenseWorkingCol,
  pivots: Int32Array,
  reduced: (Int32Array | null)[]
): DenseColumnAdapter {
  return { kind: "dense", pivots, reduced, working };
}

export function columnStoreColumnAdapter(
  working: DenseWorkingCol,
  pivots: Int32Array,
  reduced: ColumnStore
): ColumnStoreColumnAdapter {
  return { kind: "column-store", pivots, reduced, working };
}

export function reducePhase({
  adapter,
  columnValue,
  dimension,
  emitPair,
  end,
  filtrationOrder,
  loadColumn,
  nullspace,
  pivotIndex,
  pivotValue,
  skipColumn,
  start,
  step,
}: ReductionPhaseOptions): void {
  const { pivots, working } = adapter;
  const dense = adapter.kind === "dense";

  for (let ci = start; step > 0 ? ci < end : ci > end; ci += step) {
    if (skipColumn?.(ci)) {
      continue;
    }
    loadColumn(ci);

    while (true) {
      const pivot = working.pivot();
      if (pivot < 0) {
        if (filtrationOrder === "coboundary") {
          emitPair({ birth: columnValue(ci), death: -1, dim: dimension }, ci);
        } else if (nullspace) {
          nullspace[ci] = 1;
        }
        break;
      }

      const ownedPivot = pivotIndex ? pivotIndex(pivot) : pivot;
      const previous = pivots[ownedPivot]!;
      if (previous < 0) {
        pivots[ownedPivot] = ci;
        if (dense) {
          adapter.reduced[ci] = working.toSparse();
        } else {
          working.storeInto(adapter.reduced, ci);
        }

        const columnVal = columnValue(ci);
        const pivotVal = pivotValue(ownedPivot);
        if (
          filtrationOrder === "boundary"
            ? columnVal > pivotVal
            : pivotVal > columnVal
        ) {
          emitPair(
            filtrationOrder === "boundary"
              ? { birth: pivotVal, death: columnVal, dim: dimension }
              : { birth: columnVal, death: pivotVal, dim: dimension },
            ci
          );
        }
        break;
      }

      const previousColumn = dense
        ? (adapter.reduced[previous] ?? null)
        : adapter.reduced.get(previous);
      if (previousColumn === null) {
        break;
      }
      working.xorSparse(previousColumn);
    }
  }
}

export function collectEssentialClasses(
  pivots: Int32Array,
  candidates: Uint8Array,
  valueAt: (index: number) => number,
  dimension: number,
  emitPair: (pair: PersistencePair) => void
): void {
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] && pivots[i]! < 0) {
      emitPair({ birth: valueAt(i), death: -1, dim: dimension });
    }
  }
}

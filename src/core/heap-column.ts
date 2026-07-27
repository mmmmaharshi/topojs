import { ColumnStore } from "./reduction.ts";

export type HeapDirection = "max" | "min";

interface HeapEntry {
  rank: number;
  val: number;
}

function makeHeapCmp(dir: HeapDirection): (a: HeapEntry, b: HeapEntry) => boolean {
  if (dir === "max") {
    return (a, b) => a.val > b.val || (a.val === b.val && a.rank > b.rank);
  }
  return (a, b) => a.val < b.val || (a.val === b.val && a.rank < b.rank);
}

/**
 * HeapColumn — sparse column backed by a binary max-heap with lazy-deletion.
 *
 * The source of truth is a `Map<rank, val>` of active entries. The heap is a
 * max-heap under a configurable comparator (`max` or `min` direction), used
 * solely to find the pivot in O(1) via peek — it may contain stale entries
 * (ranks not in the Map) that are popped lazily during `pivot()`.
 *
 * DIRECTION:
 * - `"max"` (boundary/homology direction): pivot = entry with the MAXIMUM
 *   `(val, rank)` — the "latest" simplex in filtration order. This is the
 *   standard convention for boundary matrix reduction, matching
 *   DenseWorkingCol.pivot()'s "highest set bit" semantics.
 * - `"min"` (coboundary/cohomology direction): pivot = entry with the
 *   MINIMUM `(val, rank)` — the "earliest" simplex in filtration order.
 *   Cohomology reverses the row/column order (Bauer 2019 §3.3), so the
 *   pivot becomes the oldest remaining entry, not the newest. Use this
 *   for the cohomology reduction loop instead of the explicit `flip` trick.
 *
 *   Callers MUST use the SAME direction for all operations on one instance —
 *   mixing directions silently produces wrong pivots (the bug is invisible
 *   at the call site, which is exactly why this docstring exists).
 */
export class HeapColumn {
  private readonly getVal: (rank: number) => number;
  private readonly cmp: (a: HeapEntry, b: HeapEntry) => boolean;
  private entries: Map<number, number>;
  private heap: HeapEntry[];

  constructor(
    getVal: (rank: number) => number,
    direction: HeapDirection = "max",
  ) {
    this.getVal = getVal;
    this.cmp = makeHeapCmp(direction);
    this.entries = new Map();
    this.heap = [];
  }

  clear(): void {
    this.entries.clear();
    this.heap = [];
  }

  loadFromArray(arr: Int32Array): void {
    this.entries.clear();
    this.heap = [];
    for (let i = 0; i < arr.length; i++) {
      const rank = arr[i]!;
      const val = this.getVal(rank);
      this.entries.set(rank, val);
      this.heapPush({ rank, val });
    }
  }

  loadFromNumbers(arr: number[]): void {
    this.entries.clear();
    this.heap = [];
    for (const rank of arr) {
      const val = this.getVal(rank);
      this.entries.set(rank, val);
      this.heapPush({ rank, val });
    }
  }

  xorSparse(col: Int32Array): void {
    for (let i = 0; i < col.length; i++) {
      const rank = col[i]!;
      if (this.entries.has(rank)) {
        this.entries.delete(rank);
      } else {
        const val = this.getVal(rank);
        this.entries.set(rank, val);
        this.heapPush({ rank, val });
      }
    }
  }

  pivot(): number {
    while (this.heap.length > 0) {
      const top = this.heap[0]!;
      if (!this.entries.has(top.rank)) {
        this.heapPop();
        continue;
      }
      return top.rank;
    }
    return -1;
  }

  storeInto(store: ColumnStore, slot: number): void {
    const sparse = this.toSparse();
    store.set(slot, sparse);
  }

  toSparse(): Int32Array {
    const sorted = [...this.entries.keys()].sort((a, b) => a - b);
    const result = new Int32Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      result[i] = sorted[i]!;
    }
    return result;
  }

  private heapPush(entry: HeapEntry): void {
    this.heap.push(entry);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.cmp(this.heap[parent]!, this.heap[i]!)) {
        break;
      }
      const tmp = this.heap[parent]!;
      this.heap[parent] = this.heap[i]!;
      this.heap[i] = tmp;
      i = parent;
    }
  }

  private heapPop(): HeapEntry {
    const result = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      const n = this.heap.length;
      while (true) {
        let largest = i;
        const left = (i << 1) | 1;
        const right = left + 1;
        if (left < n && this.cmp(this.heap[left]!, this.heap[largest]!)) {
          largest = left;
        }
        if (right < n && this.cmp(this.heap[right]!, this.heap[largest]!)) {
          largest = right;
        }
        if (largest === i) {
          break;
        }
        const tmp = this.heap[i]!;
        this.heap[i] = this.heap[largest]!;
        this.heap[largest] = tmp;
        i = largest;
      }
    }
    return result;
  }
}

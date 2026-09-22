import type { ColumnStore } from "./reduction.ts";

export type HeapDirection = "max" | "min";

// Integer hash for open addressing (Knuth multiplicative, imul keeps 32-bit).
const HASH_MULT = 2_654_435_761;
const EMPTY = -1; // ranks are combinatorial indices, always >= 0

/**
 * HeapColumn — sparse column backed by a binary heap with lazy-deletion.
 *
 * Membership is a flat open-addressing hash set (Int32 keys + Float64 vals,
 * linear probing, backward-shift deletion): no `Map`, no per-entry boxed
 * objects, no megamorphic closures — every hot path is monomorphic
 * typed-array access, so V8 stays on fast elements kinds and nothing is
 * allocated per column entry. The heap itself is two parallel arrays
 * (`hRank`/`hVal`) instead of an array of `{rank, val}` objects, and may
 * contain stale ranks (deleted since) that are popped lazily during
 * `pivot()`. A scratch buffer makes `toSparse()` allocation-free except for
 * its returned output.
 *
 * Why a hash set instead of the epoch-stamped dense arrays used by
 * DenseWorkingCol (reduction.ts): ranks here are COMBINATORIAL indices into
 * C(n,3)/C(n,4) (up to ~10^10 for n in the hundreds), so a universe-sized
 * stamp array would cost gigabytes; the active column is only dozens to
 * hundreds of entries, so a table sized to the column (starting at 64 slots,
 * doubling at 0.7 load) is orders of magnitude smaller. `getVal` stays
 * deterministic per rank (filtration value lookup), so a stamp-style
 * presence check is exact — no value-staleness check needed on pop.
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
  private readonly isMax: boolean;
  // Open-addressing membership table (pow2 capacity, EMPTY = free slot).
  private keys: Int32Array;
  private vals: Float64Array;
  private mask: number;
  private size = 0;
  // Binary heap over parallel arrays (lazy deletion: stale ranks popped in
  // pivot()). Heap order is by (val, rank) under the instance direction.
  private hRank: Int32Array;
  private hVal: Float64Array;
  private hLen = 0;
  // Scratch for toSparse(): sized to the membership table so it always fits
  // the active set; sorting it in place keeps per-call garbage to the output.
  private scratch: Int32Array;

  constructor(
    getVal: (rank: number) => number,
    direction: HeapDirection = "max"
  ) {
    this.getVal = getVal;
    this.isMax = direction === "max";
    const cap = 64;
    this.keys = new Int32Array(cap).fill(EMPTY);
    this.vals = new Float64Array(cap);
    this.mask = cap - 1;
    this.hRank = new Int32Array(cap);
    this.hVal = new Float64Array(cap);
    this.scratch = new Int32Array(cap);
  }

  clear(): void {
    this.keys.fill(EMPTY);
    this.size = 0;
    this.hLen = 0;
  }

  loadFromNumbers(arr: number[]): void {
    this.clear();
    for (const rank of arr) {
      this.add(rank, this.getVal(rank));
    }
  }

  xorSparse(col: Int32Array): void {
    for (const rank of col) {
      if (!this.toggle(rank)) {
        this.add(rank, this.getVal(rank));
      }
    }
  }

  pivot(): number {
    while (this.hLen > 0) {
      const top = this.hRank[0]!;
      if (!this.has(top)) {
        this.heapPop();
        continue;
      }
      return top;
    }
    return -1;
  }

  storeInto(store: ColumnStore, slot: number): void {
    const sparse = this.toSparse();
    store.set(slot, sparse);
  }

  toSparse(): Int32Array {
    const { keys, scratch } = this;
    let count = 0;
    for (const k of keys) {
      if (k !== EMPTY) {
        scratch[count++] = k;
      }
    }
    // Numeric ascending (default typed-array sort, no comparator allocation).
    // eslint-disable-next-line unicorn/no-array-sort
    scratch.subarray(0, count).sort();
    return scratch.slice(0, count);
  }

  /** Probe slot for `rank`: the slot holding it, or the first free slot. */
  private probe(rank: number): number {
    const { keys, mask } = this;
    let i = Math.imul(rank, HASH_MULT) & mask;
    while (true) {
      const k = keys[i]!;
      if (k === EMPTY || k === rank) {
        return i;
      }
      i = (i + 1) & mask;
    }
  }

  private has(rank: number): boolean {
    const k = this.keys[this.probe(rank)]!;
    return k === rank;
  }

  /**
   * Insert `(rank, val)`; duplicate inserts are idempotent (no heap
   * duplicate — the old Map version pushed a harmless stale heap dupe, but
   * skipping it keeps the heap tight). Grows the table at 0.7 load.
   */
  private add(rank: number, val: number): void {
    if (this.size + 1 > this.keys.length * 0.7) {
      this.grow();
    }
    const i = this.probe(rank);
    const found = this.keys[i]!;
    if (found === rank) {
      return;
    }
    this.keys[i] = rank;
    this.vals[i] = val;
    this.size++;
    this.heapPush(rank, val);
  }

  /**
   * Delete `rank` if present (Knuth 6.4R backward shift keeps probe chains
   * valid, so no tombstones: each following cluster entry whose probe path
   * passes the hole moves into it). Returns true when something was removed.
   */
  private toggle(rank: number): boolean {
    const { keys, vals, mask } = this;
    const i = this.probe(rank);
    const found = keys[i]!;
    if (found !== rank) {
      return false;
    }
    this.size--;
    keys[i] = EMPTY;
    let hole = i;
    let j = i;
    while (true) {
      j = (j + 1) & mask;
      const rk = keys[j]!;
      if (rk === EMPTY) {
        break;
      }
      const home = Math.imul(rk, HASH_MULT) & mask;
      // Movable iff the hole lies on rk's probe path from home to j, i.e.
      // the hole is cyclically inside [home..j]. Non-movable entries are
      // simply skipped (the scan continues past them).
      const movable =
        home <= j
          ? hole >= home && hole <= j
          : hole >= home || hole <= j;
      if (movable) {
        keys[hole] = rk;
        vals[hole] = vals[j]!;
        hole = j;
      }
    }
    keys[hole] = EMPTY;
    return true;
  }

  /** Double the table and rehash all active entries. */
  private grow(): void {
    const oldKeys = this.keys;
    const oldVals = this.vals;
    const cap = oldKeys.length * 2;
    this.keys = new Int32Array(cap).fill(EMPTY);
    this.vals = new Float64Array(cap);
    this.mask = cap - 1;
    this.size = 0;
    for (let i = 0; i < oldKeys.length; i++) {
      const k = oldKeys[i]!;
      if (k !== EMPTY) {
        const slot = this.probe(k);
        this.keys[slot] = k;
        this.vals[slot] = oldVals[i]!;
        this.size++;
      }
    }
    if (this.scratch.length < cap) {
      this.scratch = new Int32Array(cap);
    }
  }

  /** True when entry a outranks b under the instance direction. */
  private better(
    aVal: number,
    aRank: number,
    bVal: number,
    bRank: number
  ): boolean {
    if (aVal !== bVal) {
      return this.isMax ? aVal > bVal : aVal < bVal;
    }
    return this.isMax ? aRank > bRank : aRank < bRank;
  }

  private heapPush(rank: number, val: number): void {
    if (this.hLen === this.hRank.length) {
      const cap = this.hRank.length * 2;
      const nr = new Int32Array(cap);
      nr.set(this.hRank);
      this.hRank = nr;
      const nv = new Float64Array(cap);
      nv.set(this.hVal);
      this.hVal = nv;
    }
    const { hRank, hVal } = this;
    hRank[this.hLen] = rank;
    hVal[this.hLen] = val;
    let i = this.hLen;
    this.hLen++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (
        this.better(hVal[parent]!, hRank[parent]!, hVal[i]!, hRank[i]!)
      ) {
        break;
      }
      const tr = hRank[parent]!;
      const tv = hVal[parent]!;
      hRank[parent] = hRank[i]!;
      hVal[parent] = hVal[i]!;
      hRank[i] = tr;
      hVal[i] = tv;
      i = parent;
    }
  }

  private heapPop(): void {
    this.hLen--;
    const { hRank, hVal } = this;
    const lr = hRank[this.hLen]!;
    const lv = hVal[this.hLen]!;
    if (this.hLen > 0) {
      hRank[0] = lr;
      hVal[0] = lv;
      let i = 0;
      const n = this.hLen;
      while (true) {
        let best = i;
        const left = (i << 1) | 1;
        const right = left + 1;
        if (
          left < n &&
          this.better(hVal[left]!, hRank[left]!, hVal[best]!, hRank[best]!)
        ) {
          best = left;
        }
        if (
          right < n &&
          this.better(hVal[right]!, hRank[right]!, hVal[best]!, hRank[best]!)
        ) {
          best = right;
        }
        if (best === i) {
          break;
        }
        const tr = hRank[i]!;
        const tv = hVal[i]!;
        hRank[i] = hRank[best]!;
        hVal[i] = hVal[best]!;
        hRank[best] = tr;
        hVal[best] = tv;
        i = best;
      }
    }
  }
}

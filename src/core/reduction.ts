// This file used to also export computeH1/computeH1Dense (a sparse-array and
// a dense-bitvector standalone H1 reducer) and a HIGH_BIT_TABLE lookup
// table. All three were found to be dead code during a codebase audit
// (2026-07): zero call sites anywhere in src/, test/, or bench/, not
// re-exported from src/index.ts, and unreachable externally since
// package.json's `exports` map restricts the package to a single "."
// entry point. Worse, computeH1/computeH1Dense had real correctness gaps
// relative to the live H1 phase used everywhere else in this codebase
// (homology.ts et al.) -- no zero-persistence guard (would emit spurious
// birth===death pairs, the same class of bug fixed in cubical.ts around
// the same time) and no essential-pair emission for surviving cycle edges.
// Since they were unreachable, fixing them to parity would have meant
// maintaining a second, untested H1 implementation with no consumer;
// deleting was the lower-risk choice. xorSparse and DenseWorkingCol below
// ARE live (used by cubical.ts, homology.ts, homology-fast.ts,
// homology-cohom.ts, incremental-h1.ts) and were untouched.

/* eslint-disable max-classes-per-file */
/**
 * XOR two sorted Int32Arrays (symmetric difference of sorted index lists).
 *
 * Used for column operations in the boundary matrix reduction:
 *   col ← col ⊕ pivotCol  (eliminates the pivot edge from col).
 *
 * Time: O(|a| + |b|) — single pass merge, no sorting needed.
 * Space: O(|a| + |b|) for the result array.
 */
export function xorSparse(a: Int32Array, b: Int32Array): Int32Array {
  const tmp: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const va = a[i]!;
    const vb = b[j]!;
    if (va < vb) {
      tmp.push(va);
      i++;
    } else if (vb < va) {
      tmp.push(vb);
      j++;
    } else {
      i++;
      j++;
    }
  }
  while (i < a.length) {
    tmp.push(a[i++]!);
  }
  while (j < b.length) {
    tmp.push(b[j++]!);
  }
  const result = new Int32Array(tmp.length);
  for (let k = 0; k < tmp.length; k++) {
    result[k] = tmp[k]!;
  }
  return result;
}

/**
 * Column store — fixed-block-backed map from slot index to sparse column.
 *
 * Replaces `(Int32Array | null)[]` (a JS Array of nullable Int32Arrays) with
 * a linked-list of fixed-size Int32Array blocks. Each column is written into
 * the current block and retrieved as a stable `subarray` view (blocks are
 * never relocated, so views into them remain valid indefinitely). This
 * eliminates per-column `slice()` allocations from `toSparse()` and replaces
 * dictionary-mode JS Array element accesses with typed-array accesses.
 */
export class ColumnStore {
  private static readonly BLOCK_LOG2 = 12; // 4096 elements per block
  private static readonly BLOCK_MASK = (1 << ColumnStore.BLOCK_LOG2) - 1;
  private static readonly BLOCK_SIZE = 1 << ColumnStore.BLOCK_LOG2;

  private blocks: Int32Array[] = [new Int32Array(ColumnStore.BLOCK_SIZE)];
  private blockIdx = 0;
  private blockOff = 0;
  private starts: Int32Array;
  private lengths: Int32Array;

  constructor(capacity: number) {
    this.starts = new Int32Array(capacity).fill(-1);
    this.lengths = new Int32Array(capacity);
  }

  /** Store `values` at slot `idx`. */
  set(idx: number, values: Int32Array): void {
    const len = values.length;
    this.ensureSpace(len);
    const block = this.blocks[this.blockIdx]!;
    const off = this.blockOff;
    for (let i = 0; i < len; i++) {
      block[off + i] = values[i]!;
    }
    this.starts[idx] = (this.blockIdx << ColumnStore.BLOCK_LOG2) | off;
    this.lengths[idx] = len;
    this.blockOff += len;
  }

  /** Store `count` leading entries of `scratch` at slot `idx`. */
  setFromScratch(idx: number, scratch: Int32Array, count: number): void {
    this.ensureSpace(count);
    const block = this.blocks[this.blockIdx]!;
    const off = this.blockOff;
    for (let i = 0; i < count; i++) {
      block[off + i] = scratch[i]!;
    }
    this.starts[idx] = (this.blockIdx << ColumnStore.BLOCK_LOG2) | off;
    this.lengths[idx] = count;
    this.blockOff += count;
  }

  /** Retrieve column at slot `idx`, or null if never stored. */
  get(idx: number): Int32Array | null {
    const packed = this.starts[idx]!;
    if (packed < 0) {
      return null;
    }
    const bi = packed >>> ColumnStore.BLOCK_LOG2;
    const off = packed & ColumnStore.BLOCK_MASK;
    return this.blocks[bi]!.subarray(off, off + this.lengths[idx]!);
  }

  private ensureSpace(needed: number): void {
    if (this.blockOff + needed <= ColumnStore.BLOCK_SIZE) {
      return;
    }
    this.blockIdx++;
    this.blockOff = 0;
    if (this.blockIdx >= this.blocks.length) {
      this.blocks.push(new Int32Array(ColumnStore.BLOCK_SIZE));
    }
  }
}

/**
 * DenseWorkingCol — bit-vector column representation for boundary matrix reduction.
 *
 * Each column of the boundary matrix is stored as a dense bit-vector packed
 * into Uint32Array words (32 rows per word).  This enables O(1) pivot search
 * (via Math.clz32 on the highest non-zero word) and fast XOR of sparse
 * pivot columns (32 indices per word XOR).
 *
  * Key operations and their complexity (W = ceil(numRows / 32),
  * D = number of touched ("dirty") words since the last load):
  *   pivot()      — O(D) worst-case, O(1) average (early exit at high word)
  *   xorSparse()  — O(|col|) — one word XOR per sparse entry
  *   toSparse()   — O(D log D + popcount) sparse / O(maxDirty) dense
  *   load         — O(D) instead of O(W) fill(0)
  *
  * Dirty-word tracking: every word index written since the last load
  * is recorded once in `dirty` (deduplicated via the `stamp` epoch array),
  * so pivot()/extractBits() only visit touched words instead of all
  * W. Class invariant: any nonzero word is dirty (zeroing on load
  * walks exactly the dirty list). Callers only use the public methods and
  * never touch `bits` directly, so the invariant is maintained internally.
 *
 * Compared to a pure-sparse representation (Int32Array per column):
 *   - Pivot is O(1) vs. O(log |col|) for sparse
 *   - XOR is O(|col|) vs. O(|col|) for sparse (same)
 *   - Memory is O(numRows / 32) per column vs. O(|col|) for sparse
 *
 * As columns fill up during reduction (from ~3 to O(numRows) entries),
 * the DenseWorkingCol representation becomes progressively more efficient.
 */
export class DenseWorkingCol {
  bits: Uint32Array;
  words: number;
  // Scratch buffer for toSparse(): any set bit is a row index < numRows,
  // so numRows is a safe upper bound on the number of set bits, letting us
  // write directly into a preallocated typed array instead of a boxed JS
  // array + push(). Reused across calls.
  private scratch: Int32Array;
  // Dirty-word bookkeeping (see class docstring): `dirty[0..dirtyCount)`
  // lists each touched word once per epoch; `stamp[w] === epoch` dedupes;
  // `maxDirty` bounds the pivot scan. `epoch` starts at 1 so fresh-zero
  // stamp arrays always read as clean.
  private dirty: Int32Array;
  private stamp: Int32Array;
  private dirtyCount = 0;
  private maxDirty = -1;
  private epoch = 1;

  constructor(numEdges: number) {
    this.words = Math.ceil(numEdges / 32);
    this.bits = new Uint32Array(this.words);
    this.scratch = new Int32Array(numEdges);
    this.dirty = new Int32Array(this.words);
    this.stamp = new Int32Array(this.words);
  }

  /** Record word `w` as touched (deduplicated via epoch stamps). */
  private touch(w: number): void {
    if (this.stamp[w] !== this.epoch) {
      this.stamp[w] = this.epoch;
      this.dirty[this.dirtyCount++] = w;
      if (w > this.maxDirty) {
        this.maxDirty = w;
      }
    }
  }

  /**
   * Zero exactly the dirty words and start a fresh epoch. Replaces the old
   * `bits.fill(0)` (O(W)) with O(D) work; the class invariant (any nonzero
   * word is dirty) makes zeroing only dirty words exact.
   */
  private reset(): void {
    const { bits, dirty } = this;
    for (let i = 0; i < this.dirtyCount; i++) {
      bits[dirty[i]!] = 0;
    }
    this.dirtyCount = 0;
    this.maxDirty = -1;
    if (this.epoch === 2_147_483_647) {
      this.stamp.fill(0);
      this.epoch = 1;
    } else {
      this.epoch++;
    }
  }

  /**
  * Grow (never shrink) this instance's backing storage to accommodate at
   * least `numEdges` rows, reallocating `bits`/`scratch` only if the current
   * capacity is insufficient. A no-op otherwise. Lets one DenseWorkingCol be
   * reused across many calls with slightly varying `numEdges` (e.g. a
   * sliding window whose edge count fluctuates by a handful per push)
   * instead of allocating a fresh instance every time -- added after an
   * audit found IncrementalH1.push() was doing exactly that (a third,
   * transient-per-push instance of the same "allocate per item" pattern
   * already fixed twice for its RETAINED state; see that class's docstring).
   * Safe because `loadFromArray`/`loadFromNumbers` always reset the dirty
   * state before setting bits, so any extra high words left over from a
   * previous, larger `numEdges` are harmlessly zero and skipped by `pivot()`.
   */
  ensureCapacity(numEdges: number): void {
    const words = Math.ceil(numEdges / 32);
    if (words > this.words) {
      this.words = words;
      this.bits = new Uint32Array(words);
      // Fresh-zero stamps read as clean (epoch >= 1); fresh-zero bits keep
      // the nonzero-implies-dirty invariant.
      this.dirty = new Int32Array(words);
      this.stamp = new Int32Array(words);
      this.dirtyCount = 0;
      this.maxDirty = -1;
    }
    if (numEdges > this.scratch.length) {
      this.scratch = new Int32Array(numEdges);
    }
  }

  loadFromArray(arr: Int32Array): void {
    this.reset();
    const { bits } = this;
    for (const e of arr) {
      const w = e >>> 5;
      bits[w]! |= 1 << (e & 31);
      this.touch(w);
    }
  }

  loadFromNumbers(arr: number[]): void {
    this.reset();
    const { bits } = this;
    for (const e of arr) {
      const w = e >>> 5;
      bits[w]! |= 1 << (e & 31);
      this.touch(w);
    }
  }

  xorSparse(col: Int32Array): void {
    const { bits } = this;
    for (const e of col) {
      const w = e >>> 5;
      bits[w]! ^= 1 << (e & 31);
      this.touch(w);
    }
  }

  pivot(): number {
    const { bits } = this;
    // Bounded by maxDirty instead of words: clean words are zero by the
    // class invariant, so skipping them only removes wasted reads.
    for (let w = this.maxDirty; w >= 0; w--) {
      const word = bits[w]!;
      if (word) {
        return (w << 5) + (31 - Math.clz32(word));
      }
    }
    return -1;
  }

  /** Populate scratch with extracted bits and return count. */
  private extractBits(): number {
    const { scratch, bits } = this;
    let count = 0;
    if (this.dirtyCount > (this.words >>> 1)) {
      // Dense column: bounded linear scan (ascending => sorted output).
      for (let w = 0; w <= this.maxDirty; w++) {
        let word = bits[w]!;
        while (word) {
          const lsb = word & -word;
          const bit = Math.clz32(lsb) ^ 31;
          scratch[count++] = (w << 5) + bit;
          word ^= lsb;
        }
      }
      return count;
    }
    // Sparse column: visit only dirty words, sorted ascending so the
    // output matches the old full-scan order exactly (dedup guaranteed by
    // the epoch stamps, so no row index is emitted twice). In-place sort is
    // intentional: toSorted() would allocate on every toSparse/storeInto.
    // eslint-disable-next-line unicorn/no-array-sort
    const dirty = this.dirty.subarray(0, this.dirtyCount).sort();
    for (const w of dirty) {
      let word = bits[w]!;
      while (word) {
        const lsb = word & -word;
        const bit = Math.clz32(lsb) ^ 31;
        scratch[count++] = (w << 5) + bit;
        word ^= lsb;
      }
    }
    return count;
  }

  /** Store the current column into a ColumnStore at the given slot. */
  storeInto(store: ColumnStore, slot: number): void {
    const count = this.extractBits();
    store.setFromScratch(slot, this.scratch, count);
  }

  /** Extract as a standalone Int32Array (allocates each call). */
  toSparse(): Int32Array {
    const count = this.extractBits();
    return this.scratch.slice(0, count);
  }
}

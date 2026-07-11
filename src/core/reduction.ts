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
      tmp.push(va); i++;
    } else if (vb < va) {
      tmp.push(vb); j++;
    } else {
      i++; j++;
    }
  }
  while (i < a.length) tmp.push(a[i++]!);
  while (j < b.length) tmp.push(b[j++]!);
  const result = new Int32Array(tmp.length);
  for (let k = 0; k < tmp.length; k++) result[k] = tmp[k]!;
  return result;
}

/**
 * DenseWorkingCol — bit-vector column representation for boundary matrix reduction.
 *
 * Each column of the boundary matrix is stored as a dense bit-vector packed
 * into Uint32Array words (32 rows per word).  This enables O(1) pivot search
 * (via Math.clz32 on the highest non-zero word) and fast XOR of sparse
 * pivot columns (32 indices per word XOR).
 *
 * Key operations and their complexity (W = ceil(numRows / 32)):
 *   pivot()      — O(W) worst-case, O(1) average (early exit at high word)
 *   xorSparse()  — O(|col|) — one word XOR per sparse entry
 *   toSparse()   — O(W × popcount) — extract set bits into Int32Array
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
  // array + push(). Reused across calls (each call only reads the first
  // `count` slots it just wrote, via the returned slice()).
  private scratch: Int32Array;

  constructor(numEdges: number) {
    this.words = Math.ceil(numEdges / 32);
    this.bits = new Uint32Array(this.words);
    this.scratch = new Int32Array(numEdges);
  }

  clear(): void {
    this.bits.fill(0);
  }

  loadFromArray(arr: Int32Array): void {
    this.bits.fill(0);
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i]!;
      this.bits[e >>> 5]! |= 1 << (e & 31);
    }
  }

  loadFromNumbers(arr: number[]): void {
    this.bits.fill(0);
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i]!;
      this.bits[e >>> 5]! |= 1 << (e & 31);
    }
  }

  xorSparse(col: Int32Array): void {
    for (let i = 0; i < col.length; i++) {
      const e = col[i]!;
      this.bits[e >>> 5]! ^= 1 << (e & 31);
    }
  }

  pivot(): number {
    for (let w = this.words - 1; w >= 0; w--) {
      const word = this.bits[w]!;
      if (word) {
        return (w << 5) + (31 - Math.clz32(word));
      }
    }
    return -1;
  }

  toSparse(): Int32Array {
    const scratch = this.scratch;
    let count = 0;
    for (let w = 0; w < this.words; w++) {
      let word = this.bits[w]!;
      while (word) {
        const lsb = word & -word;
        const bit = Math.clz32(lsb) ^ 31;
        scratch[count++] = (w << 5) + bit;
        word ^= lsb;
      }
    }
    // Same values, same order (word-ascending, low-bit-first within word)
    // as the original tmp-array version -- slice() copies out an owned,
    // correctly-sized Int32Array with no JS-array boxing in the hot loop.
    return scratch.slice(0, count);
  }
}


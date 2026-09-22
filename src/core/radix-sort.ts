/**
 * Stable LSD radix sort for simplex arrays by their `.val` filtration value.
 *
 * Replaces the `arr.sort((a, b) => a.val - b.val)` global sorts in the
 * complex builders (triangles/tetrahedra in complex.ts, lune triangles in
 * homology-reduced.ts, per-level simplices in complex-general.ts). Those
 * sorts are O(T log T) COMPARISONS, each one a JS closure call with two
 * property loads -- for dense inputs the triangle sort alone is a
 * double-digit share of total build time. This is O(4T): four 16-bit
 * counting passes over the float-bit representation, zero closures, typed
 * arrays only.
 *
 * CORRECTNESS (byte-identical output, not just "same multiset"):
 * - Nonnegative float64 values compare EXACTLY like their raw 64-bit
 *   patterns interpreted as unsigned integers (exponent bytes are more
 *   significant than mantissa bytes, and all our values share sign bit 0),
 *   so an LSD radix pass sequence orders them identically to `a - b`.
 * - Every counting pass is stable (source scanned in order into running
 *   offsets), and LSD stability composes: the final order equals a STABLE
 *   comparison sort, tie order included. This matters: general.ts's face
 *   indices and the engines' column orders are position-dependent, so any
 *   tie reordering would silently change results.
 * - Fallbacks (identical to today's behavior, the native comparator sort):
 *   small arrays below RADIX_MIN_N (fixed counting overhead loses there),
 *   big-endian platforms (word addressing below assumes LE -- checked once),
 *   or ANY negative/-0 value detected during key extraction (all current
 *   call sites produce sqrt/max-of-sqrt values >= +0, so this path should
 *   never trigger; it exists as insurance, not as a hot path).
 */

// Below this length the fixed cost of zeroing/scanning the 64K counting
// table exceeds the native sort -- verified by micro-bench (see
// test/radix-sort.test.ts's threshold probe notes).
const RADIX_MIN_N = 4096;
const NUM_BUCKETS = 65_536;
// 16-bit digit mask (decimal: the linter rejects hex literal style here).
const DIGIT_MASK = 65_535;

// Little-endian check, evaluated once: the key-word addressing below reads
// the high 32 bits of each float64 at u32 offset 2*i+1, which is only the
// sign/exponent word on little-endian platforms.
const LITTLE_ENDIAN =
  new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// Scratch buffers reused across calls (single-threaded, synchronous use
// only -- never live across a call boundary): the 64K counting table
// (256KB, the dominant fixed cost, allocated once), the float-bit key
// cache, the ping-pong index permutation, and the final-reorder buffer.
let countBuf: Uint32Array | null = null;
let keyF64 = new Float64Array(0);
let keyU32 = new Uint32Array(0);
let idxA = new Int32Array(0);
let idxB = new Int32Array(0);
let swapSpace: { val: number }[] = [];

/**
 * Sort `arr` in place by ascending `.val`, stable. Output order is identical
 * to `arr.sort((a, b) => a.val - b.val)` for all inputs (including ties),
 * via the radix fast path or the native fallback above.
 */
export function stableSortByVal<T extends { val: number }>(arr: T[]): void {
  const n = arr.length;
  if (n < RADIX_MIN_N || !LITTLE_ENDIAN) {
    arr.sort((a, b) => a.val - b.val);
    return;
  }
  if (keyF64.length < n) {
    keyF64 = new Float64Array(n);
    keyU32 = new Uint32Array(keyF64.buffer);
  }
  if (idxA.length < n) {
    idxA = new Int32Array(n);
    idxB = new Int32Array(n);
  }
  if (swapSpace.length < n) {
    swapSpace = Array.from({ length: n });
  }
  if (countBuf === null) {
    countBuf = new Uint32Array(NUM_BUCKETS);
  }
  const counts = countBuf;

  // Key extraction with sign-bit scan: any negative value (including -0,
  // whose bit pattern would sort as huge-unsigned) falls back to the native
  // comparator, which defines the reference behavior.
  for (let i = 0; i < n; i++) {
    keyF64[i] = arr[i]!.val;
  }
  for (let i = 0; i < n; i++) {
    const hi = keyU32[2 * i + 1]!;
    if (hi >>> 31) {
      arr.sort((a, b) => a.val - b.val);
      return;
    }
  }

  // Four 16-bit LSD passes (lo0, lo1, hi0, hi1) over an INDEX permutation.
  // Indices (not objects) are permuted because the cached keys are
  // positional: keyU32[2*i+..] is the key of ORIGINAL position i, so pass k
  // must look up the key through the current permutation (idxA[i]), not
  // through the live position. (Permuting the objects themselves while
  // leaving the keys behind produces garbage after the first pass.) Even
  // pass count => permutation lands back in idxA; one final reorder pass
  // writes the objects into place via swapSpace.
  for (let i = 0; i < n; i++) {
    idxA[i] = i;
  }
  let src = idxA;
  let dst = idxB;
  for (let pass = 0; pass < 4; pass++) {
    counts.fill(0);
    const word = pass < 2 ? 0 : 1;
    const shift = (pass % 2) * 16;
    for (let i = 0; i < n; i++) {
      const digit = (keyU32[2 * src[i]! + word]! >>> shift) & DIGIT_MASK;
      counts[digit]!++;
    }
    let sum = 0;
    for (let d = 0; d < NUM_BUCKETS; d++) {
      const c = counts[d]!;
      counts[d] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const s = src[i]!;
      const digit = (keyU32[2 * s + word]! >>> shift) & DIGIT_MASK;
      dst[counts[digit]!] = s;
      counts[digit]!++;
    }
    const tmp = src;
    src = dst;
    dst = tmp;
  }
  for (let i = 0; i < n; i++) {
    swapSpace[i] = arr[src[i]!]!;
  }
  for (let i = 0; i < n; i++) {
    arr[i] = swapSpace[i] as T;
  }
}

/**
 * Fixed-capacity circular buffer of points for streaming persistent homology.
 *
 * Stores the most recent `capacity` points (each `dims`-dimensional). Once
 * full, each push evicts the oldest point. Backed by a single flat
 * Float64Array (no per-point allocation) so it is cheap to push at high
 * frequency (e.g. per-sample sensor data).
 */
export class SlidingWindow {
  private readonly capacity: number;
  private readonly dims: number;
  private readonly buffer: Float64Array;
  private writeIndex: number = 0;
  private count: number = 0;

  constructor(capacity: number, dims: number) {
    if (capacity < 1) throw new Error('SlidingWindow: capacity must be >= 1');
    if (dims < 1) throw new Error('SlidingWindow: dims must be >= 1');
    this.capacity = capacity;
    this.dims = dims;
    this.buffer = new Float64Array(capacity * dims);
  }

  /** Number of points currently held (<= capacity). */
  get size(): number {
    return this.count;
  }

  /** True once the window has reached capacity (evictions have begun, or are about to). */
  get isFull(): boolean {
    return this.count === this.capacity;
  }

  /** Push one point, evicting the oldest point if the window is already full. */
  push(point: number[] | Float64Array): void {
    if (point.length !== this.dims) {
      throw new Error(`SlidingWindow: expected point of length ${this.dims}, got ${point.length}`);
    }
    const base = this.writeIndex * this.dims;
    for (let d = 0; d < this.dims; d++) {
      this.buffer[base + d] = point[d]!;
    }
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /**
   * Current contents as a flat Float64Array (length = size * dims), ordered
   * oldest-to-newest. Vietoris–Rips persistence depends only on pairwise
   * distances, so ordering has no mathematical effect on the result — this
   * ordering is purely for deterministic/debuggable output.
   */
  toFlatArray(): Float64Array {
    const out = new Float64Array(this.count * this.dims);
    if (!this.isFull) {
      // Buffer hasn't wrapped yet: valid points are [0, count), already in order.
      out.set(this.buffer.subarray(0, this.count * this.dims));
      return out;
    }
    // Full and wrapped: oldest point is at writeIndex, newest just before it.
    const tailCount = this.capacity - this.writeIndex;
    out.set(this.buffer.subarray(this.writeIndex * this.dims, this.capacity * this.dims), 0);
    out.set(this.buffer.subarray(0, this.writeIndex * this.dims), tailCount * this.dims);
    return out;
  }
}

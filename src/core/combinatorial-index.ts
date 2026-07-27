export class CombinatorialIndex {
  readonly n: number;
  readonly maxRank: number;
  private readonly binom: Float64Array;

  constructor(n: number) {
    if (n >= 2300) {
      throw new Error(
        `CombinatorialIndex n=${n} exceeds the n < 2300 limit (rank would overflow Int32Array pivot storage)`
      );
    }
    this.n = n;
    this.binom = new Float64Array(n * 5);
    for (let i = 0; i < n; i++) {
      const base = i * 5;
      this.binom[base] = 1;
      this.binom[base + 1] = i;
      this.binom[base + 2] = i <= 1 ? 0 : (i * (i - 1)) / 2;
      this.binom[base + 3] = i <= 2 ? 0 : (i * (i - 1) * (i - 2)) / 6;
      this.binom[base + 4] =
        i <= 3 ? 0 : (i * (i - 1) * (i - 2) * (i - 3)) / 24;
    }
    this.maxRank = n < 3 ? 0 : (n * (n - 1) * (n - 2)) / 6;
  }

  rank(u: number, v: number, w: number): number {
    return this.binom[w * 5 + 3]! + this.binom[v * 5 + 2]! + u;
  }

  rank4(a: number, b: number, c: number, d: number): number {
    return (
      this.binom[d * 5 + 4]! +
      this.binom[c * 5 + 3]! +
      this.binom[b * 5 + 2]! +
      a
    );
  }

  unrank4(r: number): [number, number, number, number] {
    let lo = 3;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.binom[mid * 5 + 4]! <= r) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const d = lo;
    let rem = r - this.binom[d * 5 + 4]!;

    lo = 2;
    hi = d - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.binom[mid * 5 + 3]! <= rem) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const c = lo;
    rem -= this.binom[c * 5 + 3]!;

    lo = 1;
    hi = c - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.binom[mid * 5 + 2]! <= rem) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const b = lo;
    rem -= this.binom[b * 5 + 2]!;

    return [rem, b, c, d];
  }

  unrank(r: number): [number, number, number] {
    let lo = 2;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.binom[mid * 5 + 3]! <= r) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const w = lo;
    let rem = r - this.binom[w * 5 + 3]!;

    lo = 1;
    hi = w - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.binom[mid * 5 + 2]! <= rem) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const v = lo;
    rem -= this.binom[v * 5 + 2]!;

    return [rem, v, w];
  }
}

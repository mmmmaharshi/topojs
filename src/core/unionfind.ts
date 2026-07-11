const EMPTY = -1;

export class UnionFind {
  parent: Int32Array;

  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = EMPTY;
  }

  find(x: number): number {
    const p = this.parent[x]!;
    if (p < 0) return x;
    let root = x;
    while (this.parent[root]! >= 0) root = this.parent[root]!;
    while (x !== root) {
      const next = this.parent[x]!;
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a: number, b: number): boolean {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    const sa = -this.parent[ra]!;
    const sb = -this.parent[rb]!;
    if (sa < sb) {
      const t = ra; ra = rb; rb = t;
    }
    this.parent[rb] = ra;
    this.parent[ra] = -(sa + sb);
    return true;
  }

  reset(): void {
    for (let i = 0; i < this.parent.length; i++) this.parent[i] = EMPTY;
  }
}

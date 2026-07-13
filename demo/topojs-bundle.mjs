const N = class {
  parent;
  constructor(t) {
    this.parent = new Int32Array(t);
    for (let e = 0; e < t; e++) {
      this.parent[e] = -1;
    }
  }
  find(t) {
    if (this.parent[t] < 0) {
      return t;
    }
    let s = t;
    for (; this.parent[s] >= 0;) {
      s = this.parent[s];
    }
    for (; t !== s;) {
      const r = this.parent[t];
      ((this.parent[t] = s), (t = r));
    }
    return s;
  }
  union(t, e) {
    let s = this.find(t),
      r = this.find(e);
    if (s === r) {
      return !1;
    }
    const a = -this.parent[s],
      o = -this.parent[r];
    if (a < o) {
      const u = s;
      ((s = r), (r = u));
    }
    return ((this.parent[r] = s), (this.parent[s] = -(a + o)), !0);
  }
  reset() {
    for (let t = 0; t < this.parent.length; t++) {
      this.parent[t] = -1;
    }
  }
};
function j(i, t) {
  const e = new N(i),
    s = [],
    r = new Uint8Array(t.length);
  for (let o = 0; o < t.length; o++) {
    const u = t[o];
    e.find(u.u) === e.find(u.v)
      ? (r[o] = 1)
      : (s.push({ birth: 0, death: u.val, dim: 0 }), e.union(u.u, u.v));
  }
  const a = new Uint8Array(i);
  for (let o = 0; o < i; o++) {
    const u = e.find(o);
    a[u] || ((a[u] = 1), s.push({ birth: 0, death: -1, dim: 0 }));
  }
  return { cycleEdges: r, h0Pairs: s };
}
const H = class i {
  cellSize;
  dims;
  buckets = new Map();
  static BIAS = 2 ** 31;
  constructor(t, e, s, r) {
    if (!(r > 0) || !Number.isFinite(r)) {
      throw new Error("SpatialGrid: cellSize must be a finite positive number");
    }
    ((this.cellSize = r), (this.dims = e));
    for (let a = 0; a < s; a++) {
      let o = this.cellKeyForPoint(t, a),
        u = this.buckets.get(o);
      (u || ((u = []), this.buckets.set(o, u)), u.push(a));
    }
  }
  cellCoord(t) {
    return Math.floor(t / this.cellSize);
  }
  cellKeyForPoint(t, e) {
    let s = e * this.dims,
      r = 0n;
    for (let a = 0; a < this.dims; a++) {
      const o = this.cellCoord(t[s + a]) + i.BIAS;
      r = (r << 32n) | BigInt(o);
    }
    return r;
  }
  candidatesAfter(t, e) {
    const s = e * this.dims,
      r = new Array(this.dims);
    for (let g = 0; g < this.dims; g++) {
      r[g] = this.cellCoord(t[s + g]);
    }
    const a = [],
      o = [-1, 0, 1],
      u = Math.pow(3, this.dims);
    for (let g = 0; g < u; g++) {
      let v = 0n,
        b = g;
      for (let d = 0; d < this.dims; d++) {
        const P = b % 3;
        b = Math.floor(b / 3);
        const A = r[d] + o[P] + i.BIAS;
        v = (v << 32n) | BigInt(A);
      }
      const l = this.buckets.get(v);
      if (l) {
        for (let d of l) d > e && a.push(d);
      }
    }
    return (a.toSorted((g, v) => g - v), a);
  }
};
function L(i, t, e, s) {
  let r = e * t,
    a = s * t,
    o = 0;
  for (let u = 0; u < t; u++) {
    const g = i[r + u] - i[a + u];
    o += g * g;
  }
  return Math.sqrt(o);
}
function R(i, t, e, s) {
  return (i * s + t) * s + e;
}
const G = 1e3;
function J(i, t, e, s = 2) {
  const r = i.length / t,
    a = [],
    o = Array.from({ length: r }, () => []),
    g = e > 0 && Number.isFinite(e) && r >= G ? new H(i, t, r, e) : null;
  for (let n = 0; n < r; n++) {
    const h = g ? g.candidatesAfter(i, n) : null,
      p = (m) => {
        const y = L(i, t, n, m);
        y <= e &&
          (a.push({ origIdx: o[n].length, u: n, v: m, val: y }),
          o[n].push(m),
          o[m].push(n));
      };
    if (h) {
      for (const m of h) {
        p(m);
      }
    } else {
      for (let m = n + 1; m < r; m++) {
        p(m);
      }
    }
  }
  a.sort((n, h) => n.val - h.val || n.origIdx - h.origIdx);
  const v = a.map((n) => ({ u: n.u, v: n.v, val: n.val })),
    b = r < G ? new Int32Array(r * r).fill(-1) : null,
    l = b ? null : new Map(),
    d = (n, h, p) => {
      b ? (b[n * r + h] = p) : l.set(n * r + h, p);
    },
    P = (n, h) => (b ? b[n * r + h] : l.get(n * r + h));
  for (let n = 0; n < v.length; n++) {
    const h = v[n];
    d(h.u, h.v, n);
  }
  for (let n = 0; n < r; n++) {
    o[n].sort((h, p) => h - p);
  }
  const A = Math.ceil(r / 32),
    E = new Array(r);
  for (let n = 0; n < r; n++) {
    const h = new Uint32Array(A),
      p = o[n];
    for (let m = 0; m < p.length; m++) {
      h[p[m] >>> 5] |= 1 << (p[m] & 31);
    }
    E[n] = h;
  }
  const x = [];
  for (let n = 0; n < v.length; n++) {
    const { u: h, v: p, val: m } = v[n],
      y = E[h],
      w = E[p],
      k = (p + 1) >>> 5,
      S = (p + 1) & 31;
    for (let I = k; I < A; I++) {
      let D = y[I] & w[I];
      for (I === k && S > 0 && (D &= ~((1 << S) - 1)); D;) {
        const M = D & -D,
          T = Math.clz32(M) ^ 31,
          F = (I << 5) + T;
        D ^= M;
        const $ = P(h, F),
          C = P(p, F),
          U = v[$].val,
          z = v[C].val,
          _ = Math.max(m, U, z);
        x.push({ edges: [n, $, C], val: _, verts: [h, p, F] });
      }
    }
  }
  x.sort((n, h) => n.val - h.val);
  const c = new Map();
  for (let n = 0; n < x.length; n++) {
    const [h, p, m] = x[n].verts;
    c.set(R(h, p, m, r), n);
  }
  const f = [];
  if (s >= 3) {
    for (let n = 0; n < x.length; n++) {
      const [h, p, m] = x[n].verts,
        y = x[n].val,
        w = E[h],
        k = E[p],
        S = E[m],
        I = (m + 1) >>> 5,
        D = (m + 1) & 31;
      for (let M = I; M < A; M++) {
        let T = w[M] & k[M] & S[M];
        for (M === I && D > 0 && (T &= ~((1 << D) - 1)); T;) {
          const F = T & -T,
            $ = Math.clz32(F) ^ 31,
            C = (M << 5) + $;
          T ^= F;
          const U = v[P(h, C)].val,
            z = v[P(p, C)].val,
            _ = v[P(m, C)].val,
            Y = Math.max(y, U, z, _);
          f.push({
            triangles: [
              c.get(R(p, m, C, r)),
              c.get(R(h, m, C, r)),
              c.get(R(h, p, C, r)),
              n,
            ],
            val: Y,
          });
        }
      }
    }
    f.sort((n, h) => n.val - h.val);
  }
  return { edges: v, n: r, tetrahedra: f, triangles: x };
}
const B = class {
  bits;
  words;
  scratch;
  constructor(t) {
    ((this.words = Math.ceil(t / 32)),
      (this.bits = new Uint32Array(this.words)),
      (this.scratch = new Int32Array(t)));
  }
  clear() {
    this.bits.fill(0);
  }
  ensureCapacity(t) {
    const e = Math.ceil(t / 32);
    (e > this.words && ((this.words = e), (this.bits = new Uint32Array(e))),
      t > this.scratch.length && (this.scratch = new Int32Array(t)));
  }
  loadFromArray(t) {
    this.bits.fill(0);
    for (let e = 0; e < t.length; e++) {
      const s = t[e];
      this.bits[s >>> 5] |= 1 << (s & 31);
    }
  }
  loadFromNumbers(t) {
    this.bits.fill(0);
    for (let e = 0; e < t.length; e++) {
      const s = t[e];
      this.bits[s >>> 5] |= 1 << (s & 31);
    }
  }
  xorSparse(t) {
    for (let e = 0; e < t.length; e++) {
      const s = t[e];
      this.bits[s >>> 5] ^= 1 << (s & 31);
    }
  }
  pivot() {
    for (let t = this.words - 1; t >= 0; t--) {
      const e = this.bits[t];
      if (e) {
        return (t << 5) + (31 - Math.clz32(e));
      }
    }
    return -1;
  }
  toSparse() {
    let t = this.scratch,
      e = 0;
    for (let s = 0; s < this.words; s++) {
      let r = this.bits[s];
      for (; r;) {
        const a = r & -r,
          o = Math.clz32(a) ^ 31;
        ((t[e++] = (s << 5) + o), (r ^= a));
      }
    }
    return t.slice(0, e);
  }
};
function Q(i, t) {
  return Math.max(Math.abs(i[0] - t[0]), Math.abs(i[1] - t[1]));
}
function X(i, t) {
  return Q(i, t);
}
function O(i) {
  return Math.abs(i[1] - i[0]) / 2;
}
function q(i, t, e) {
  const s = i.length,
    r = t.length,
    a = s + r,
    o = r + s,
    u = Array.from({ length: a }, () => []);
  for (let b = 0; b < s; b++) {
    for (let l = 0; l < r; l++) {
      X(i[b], t[l]) <= e && u[b].push(l);
    }
    if (O(i[b]) <= e) {
      for (let l = 0; l < s; l++) {
        u[b].push(r + l);
      }
    }
  }
  for (let b = 0; b < r; b++) {
    const l = s + b;
    for (let d = 0; d < r; d++) {
      O(t[d]) <= e && u[l].push(d);
    }
    for (let d = 0; d < s; d++) {
      u[l].push(r + d);
    }
  }
  const g = new Int32Array(o).fill(-1);
  function v(b, l) {
    for (const d of u[b]) {
      if (!l[d] && ((l[d] = 1), g[d] < 0 || v(g[d], l))) {
        return ((g[d] = b), !0);
      }
    }
    return !1;
  }
  for (let b = 0; b < a; b++) {
    const l = new Uint8Array(o);
    if (!v(b, l)) {
      return !1;
    }
  }
  return !0;
}
function Z(i, t, e, s) {
  if (i.length === 0 && t.length === 0) {
    return 0;
  }
  let r = 0,
    a = e;
  if (!q(i, t, a)) {
    return 1 / 0;
  }
  if (q(i, t, r)) {
    return 0;
  }
  for (; a - r > s;) {
    const o = (r + a) / 2;
    q(i, t, o) ? (a = o) : (r = o);
  }
  return a;
}
function tt(i, t) {
  if (i.length === 0) {
    return 0;
  }
  let e = [...i].toSorted((a, o) => a - o),
    s = [...t].toSorted((a, o) => a - o),
    r = 0;
  for (let a = 0; a < e.length; a++) {
    const o = Math.abs(e[a] - s[a]);
    o > r && (r = o);
  }
  return r;
}
function K(i, t, e = 0, s = 1e6, r = 1e-6) {
  const a = i
      .filter((l) => l.dim === e && l.death >= 0)
      .map((l) => [l.birth, l.death]),
    o = t
      .filter((l) => l.dim === e && l.death >= 0)
      .map((l) => [l.birth, l.death]),
    u = i.filter((l) => l.dim === e && l.death === -1).map((l) => l.birth),
    g = t.filter((l) => l.dim === e && l.death === -1).map((l) => l.birth);
  if (u.length !== g.length) {
    return 1 / 0;
  }
  const v = tt(u, g),
    b = Z(a, o, s, r);
  return Math.max(v, b);
}
function W(i, t, e) {
  let s = (e * (e - 1)) / 2,
    r = new Float64Array(s),
    a = new Int32Array(e),
    o = 0;
  for (let u = 0; u < e; u++) {
    a[u] = o;
    for (let g = u + 1; g < e; g++) {
      const v = 0,
        b = u * t,
        l = g * t;
      for (let d = 0; d < t; d++) {
        const P = i[b + d] - i[l + d];
        v += P * P;
      }
      r[o++] = Math.sqrt(v);
    }
  }
  return { data: r, n: e, rowStart: a };
}
function et(i, t, e = 1 / 0, s = 2) {
  const r = J(i, t, e, s),
    { edges: a, triangles: o, tetrahedra: u } = r,
    { h0Pairs: g, cycleEdges: v } = j(r.n, a),
    b = new Int32Array(a.length).fill(-1),
    l = new Array(o.length).fill(null),
    d = [],
    P = new B(a.length);
  for (let c = 0; c < o.length; c++) {
    const f = o[c];
    for (P.loadFromNumbers(f.edges); ;) {
      const n = P.pivot();
      if (n < 0) {
        l[c] = new Int32Array(0);
        break;
      }
      const h = b[n];
      if (h < 0) {
        ((b[n] = c),
          (l[c] = P.toSparse()),
          f.val > a[n].val &&
            d.push({ birth: a[n].val, death: f.val, dim: 1 }));
        break;
      }
      const p = l[h];
      if (p === null) {
        break;
      }
      P.xorSparse(p);
    }
  }
  for (let c = 0; c < a.length; c++) {
    v[c] && b[c] < 0 && d.push({ birth: a[c].val, death: -1, dim: 1 });
  }
  const A = [],
    E = b.reduce((c, f) => c + (f >= 0 ? 1 : 0), 0),
    x = o.length - E;
  if (s >= 3 && x > 0) {
    const c = new Uint8Array(o.length);
    for (let m = 0; m < o.length; m++) {
      l[m] !== null && l[m].length === 0 && (c[m] = 1);
    }
    const f = new Int32Array(o.length).fill(-1),
      n = new Array(u.length).fill(null),
      h = new B(o.length);
    for (let m = 0; m < u.length; m++) {
      const y = u[m];
      for (h.loadFromNumbers(y.triangles); ;) {
        const w = h.pivot();
        if (w < 0) {
          break;
        }
        const k = f[w];
        if (k < 0) {
          ((f[w] = m),
            (n[m] = h.toSparse()),
            y.val > o[w].val &&
              A.push({ birth: o[w].val, death: y.val, dim: 2 }));
          break;
        }
        const S = n[k];
        if (S === null) {
          break;
        }
        h.xorSparse(S);
      }
    }
    const p = new Uint8Array(o.length);
    for (let m = 0; m < o.length; m++) {
      f[m] >= 0 && (p[m] = 1);
    }
    for (let m = 0; m < o.length; m++) {
      c[m] && !p[m] && A.push({ birth: o[m].val, death: -1, dim: 2 });
    }
  }
  return {
    complex: {
      numEdges: a.length,
      numTetrahedra: u.length,
      numTriangles: o.length,
      numVertices: r.n,
    },
    pairs: [...g, ...d, ...A],
  };
}
function rt(i, t, e, s = 1) {
  const r = t * e,
    a = t * (e - 1),
    o = (t - 1) * e,
    u = a + o,
    g = (t - 1) * (e - 1),
    v = new Int32Array(r),
    b = new Float64Array(r);
  for (let c = 0; c < r; c++) {
    ((v[c] = c), (b[c] = i[c]));
  }
  v.sort((c, f) => b[c] - b[f]);
  const l = [];
  for (let c = 0; c < t; c++) {
    for (let f = 0; f < e - 1; f++) {
      const n = c * e + f,
        h = c * e + f + 1;
      l.push({ origIdx: l.length, u: n, v: h, val: Math.max(i[n], i[h]) });
    }
  }
  for (let c = 0; c < t - 1; c++) {
    for (let f = 0; f < e; f++) {
      const n = c * e + f,
        h = (c + 1) * e + f;
      l.push({ origIdx: l.length, u: n, v: h, val: Math.max(i[n], i[h]) });
    }
  }
  l.sort((c, f) => c.val - f.val);
  const d = new Int32Array(u);
  for (let c = 0; c < l.length; c++) {
    d[l[c].origIdx] = c;
  }
  const P = [];
  for (let c = 0; c < t - 1; c++) {
    for (let f = 0; f < e - 1; f++) {
      const n = c * e + f,
        h = c * e + f + 1,
        p = (c + 1) * e + f,
        m = (c + 1) * e + f + 1,
        y = Math.max(i[n], i[h], i[p], i[m]),
        w = d[c * (e - 1) + f],
        k = d[(c + 1) * (e - 1) + f],
        S = d[a + c * e + f],
        I = d[a + c * e + (f + 1)];
      P.push({ edges: [w, k, S, I], val: y });
    }
  }
  P.sort((c, f) => c.val - f.val);
  const { h0Pairs: A, cycleEdges: E } = j(r, l),
    x = [];
  if (s >= 1 && g > 0) {
    const c = new Int32Array(u).fill(-1),
      f = new Array(g).fill(null),
      n = new B(u);
    for (let h = 0; h < g; h++) {
      const p = P[h];
      for (n.loadFromNumbers(p.edges); ;) {
        const m = n.pivot();
        if (m < 0) {
          break;
        }
        const y = c[m];
        if (y < 0) {
          ((c[m] = h),
            (f[h] = n.toSparse()),
            p.val > l[m].val &&
              x.push({ birth: l[m].val, death: p.val, dim: 1 }));
          break;
        }
        const w = f[y];
        if (w === null) {
          break;
        }
        n.xorSparse(w);
      }
    }
    for (let h = 0; h < u; h++) {
      E[h] && c[h] < 0 && x.push({ birth: l[h].val, death: -1, dim: 1 });
    }
  }
  return { dims: { height: t, width: e }, pairs: [...A, ...x] };
}
function V(i) {
  const t = [],
    e = [],
    s = [],
    r = [],
    a = [],
    o = [];
  for (const u of i) {
    u.dim === 0
      ? t.push(u)
      : u.dim === 1
        ? u.death < 0
          ? s.push(u)
          : e.push(u)
        : u.dim === 2
          ? u.death < 0
            ? a.push(u)
            : r.push(u)
          : o.push(u);
  }
  return {
    h0: t,
    h1essential: s,
    h1finite: e,
    h2essential: a,
    h2finite: r,
    higher: o,
  };
}
function nt(i) {
  const t = [];
  (t.push("# persistence pairs: dim birth death"),
    t.push(`# total pairs: ${i.length}`));
  for (const e of i) {
    const s = e.death < 0 ? "inf" : e.death.toFixed(6);
    t.push(`${e.dim} ${e.birth.toFixed(6)} ${s}`);
  }
  return t.join(`
`);
}
function st(i, t = !1) {
  return JSON.stringify(i, null, t ? 2 : 0);
}
function it(i) {
  const t = ["dim,birth,death"];
  for (const e of i) {
    t.push(`${e.dim},${e.birth},${e.death < 0 ? -1 : e.death}`);
  }
  return t.join(`
`);
}
function ot(i) {
  const t = V(i),
    e = [
      "h0_birth,h0_death,h1finite_birth,h1finite_death,h1essential_birth,h2finite_birth,h2finite_death,h2essential_birth",
    ],
    s = Math.max(
      t.h0.length,
      t.h1finite.length,
      t.h1essential.length,
      t.h2finite.length,
      t.h2essential.length
    );
  for (let r = 0; r < s; r++) {
    const a = t.h0[r]?.birth ?? "",
      o = t.h0[r]?.death ?? "",
      u = t.h1finite[r]?.birth ?? "",
      g = t.h1finite[r]?.death ?? "",
      v = t.h1essential[r]?.birth ?? "",
      b = t.h2finite[r]?.birth ?? "",
      l = t.h2finite[r]?.death ?? "",
      d = t.h2essential[r]?.birth ?? "";
    e.push(`${a},${o},${u},${g},${v},${b},${l},${d}`);
  }
  return e.join(`
`);
}
function at(i) {
  let t = V(i),
    e = 0,
    s = 1 / 0;
  for (const r of i) {
    (r.birth < s && (s = r.birth),
      r.death > e && r.death >= 0 && (e = r.death));
  }
  return {
    h0: t.h0.length,
    h1: t.h1finite.length + t.h1essential.length,
    h1essential: t.h1essential.length,
    h1finite: t.h1finite.length,
    h2: t.h2finite.length + t.h2essential.length,
    h2essential: t.h2essential.length,
    h2finite: t.h2finite.length,
    higher: t.higher.length,
    maxDeath: e,
    minBirth: s === 1 / 0 ? 0 : s,
    total: i.length,
  };
}
export {
  K as bottleneckDistance,
  rt as computeCubicalHomology,
  W as computePairwiseDistances,
  et as computePersistentHomology,
  V as splitByDimension,
  at as summarize,
  it as toCSV,
  ot as toDiagramCSV,
  nt as toGudhi,
  st as toJSON,
};

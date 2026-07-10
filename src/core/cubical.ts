import type { PersistencePair } from './h0.ts';
import { UnionFind } from './unionfind.ts';
import { DenseWorkingCol } from './reduction.ts';

/** Result of cubical persistence homology on a 2D grayscale image. */
export interface CubicalResult {
  /** Persistence pairs (H0 + H1). */
  pairs: PersistencePair[];
  dims: { height: number; width: number };
}

/**
 * Compute persistent homology of a 2D grayscale image via the cubical complex.
 *
 * The cubical complex has V = h·w vertices, E = h·(w−1)+(h−1)·w edges,
 * and S = (h−1)·(w−1) squares.  Vertices, edges, and squares are filtered
 * by pixel value (max of incident pixels for edges/squares).
 *
 * Algorithm:
 *   H0 — Union–Find on edges sorted by value, O(E α(V))
 *   H1 — Boundary matrix reduction of squares vs edges, O(S · E/w) bit-vector ops
 *
 * Time: O(V log V + E α(V) + S · E/w) ≈ O(V log V) for typical images
 * Space: O(V + E + S) for the complex, O(E · E/w) for the reduction matrix
 *
 * @param pixels Flat array of grayscale values (row-major), length h·w
 * @param height Image height in pixels
 * @param width Image width in pixels
 * @param maxDim Maximum homology dimension (0=H0 only, 1=H0+H1)
 */
export function computeCubicalHomology(
  pixels: Float64Array,
  height: number,
  width: number,
  maxDim: number = 1,
): CubicalResult {
  const V = height * width;
  const HE = height * (width - 1);
  const VE = (height - 1) * width;
  const numEdges = HE + VE;
  const numSquares = (height - 1) * (width - 1);

  // ── Build vertices sorted by value ──
  const vertOrder = new Int32Array(V);
  const vertVal = new Float64Array(V);
  for (let i = 0; i < V; i++) { vertOrder[i] = i; vertVal[i] = pixels[i]!; }
  vertOrder.sort((a, b) => vertVal[a]! - vertVal[b]!);

  // ── Build edges with birth values ──
  // origIdx = raster position at construction time (horizontal edges get
  // 0..HE-1 via i*(width-1)+j, vertical get HE..HE+VE-1 via HE+i*width+j) --
  // this is the SAME numbering the square-building loop below independently
  // recomputes for upperEdge/lowerEdge/leftEdge/rightEdge. It has to survive
  // the edges.sort() below, which is why it's captured here rather than
  // implied by array position (see origToSorted remap after the sort).
  interface CubicalEdge { u: number; v: number; val: number; origIdx: number; }
  const edges: CubicalEdge[] = [];

  // Horizontal edges (i,j)-(i+1,j)
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width - 1; j++) {
      const idx0 = i * width + j;
      const idx1 = i * width + j + 1;
      edges.push({ u: idx0, v: idx1, val: Math.max(pixels[idx0]!, pixels[idx1]!), origIdx: edges.length });
    }
  }
  // Vertical edges (i,j)-(i,j+1)
  for (let i = 0; i < height - 1; i++) {
    for (let j = 0; j < width; j++) {
      const idx0 = i * width + j;
      const idx1 = (i + 1) * width + j;
      edges.push({ u: idx0, v: idx1, val: Math.max(pixels[idx0]!, pixels[idx1]!), origIdx: edges.length });
    }
  }

  edges.sort((a, b) => a.val - b.val);

  // origToSorted[rasterIdx] = position of that edge in the now-sorted
  // `edges` array. BUG FIX: the square-building loop below computes edge
  // references using the raster-position formulas (upperEdge = i*(width-1)+j,
  // etc) -- those formulas describe positions in the PRE-SORT array. Using
  // them directly as indices into the POST-SORT `edges` array (as this code
  // used to do) silently wires each square's boundary to whichever edge
  // happened to land at that array slot after sorting, not the edge the
  // formula actually meant -- correct only by accident when sorting doesn't
  // permute anything (e.g. every edge has the same filtration value, which
  // is why this went uncaught: the only pre-existing tests use monochrome
  // or two-tone-but-tie-preserving images). Confirmed via Euler
  // characteristic mismatch on a real counterexample (ring-around-a-peak
  // image) before this fix; see test/cubical.test.ts.
  const origToSorted = new Int32Array(numEdges);
  for (let i = 0; i < edges.length; i++) origToSorted[edges[i]!.origIdx] = i;

  // ── Build squares ──
  interface CubicalSquare { edges: [number, number, number, number]; val: number; }
  const squares: CubicalSquare[] = [];

  for (let i = 0; i < height - 1; i++) {
    for (let j = 0; j < width - 1; j++) {
      const c00 = i * width + j;
      const c10 = i * width + j + 1;
      const c01 = (i + 1) * width + j;
      const c11 = (i + 1) * width + j + 1;
      const val = Math.max(pixels[c00]!, pixels[c10]!, pixels[c01]!, pixels[c11]!);

      const upperEdge = origToSorted[i * (width - 1) + j]!;
      const lowerEdge = origToSorted[(i + 1) * (width - 1) + j]!;
      const leftEdge = origToSorted[HE + i * width + j]!;
      const rightEdge = origToSorted[HE + i * width + (j + 1)]!;

      squares.push({ edges: [upperEdge, lowerEdge, leftEdge, rightEdge], val });
    }
  }

  squares.sort((a, b) => a.val - b.val);

  // ── H0: union-find ──
  const uf = new UnionFind(V);
  const h0Pairs: PersistencePair[] = [];
  const cycleEdges = new Uint8Array(numEdges);

  for (let ei = 0; ei < numEdges; ei++) {
    const e = edges[ei]!;
    if (uf.find(e.u) !== uf.find(e.v)) {
      h0Pairs.push({ birth: 0, death: e.val, dim: 0 });
      uf.union(e.u, e.v);
    } else {
      cycleEdges[ei] = 1;
    }
  }
  // BUG FIX: essential H0 components (survivors that never merge) were never
  // emitted -- every nonempty image reported 0 essential H0 classes, when a
  // rectangular grid always has at least one surviving component (itself,
  // at minimum, for h=w=1). Mirrors the equivalent loop in
  // src/core/homology.ts's computePersistentHomology.
  const seenRoot = new Uint8Array(V);
  for (let i = 0; i < V; i++) {
    const r = uf.find(i);
    if (!seenRoot[r]) {
      seenRoot[r] = 1;
      h0Pairs.push({ birth: 0, death: -1, dim: 0 });
    }
  }

  // ── H1: square reduction ──
  const h1Pairs: PersistencePair[] = [];

  if (maxDim >= 1 && numSquares > 0) {
    const h1Pivots = new Int32Array(numEdges).fill(-1);
    const h1reduced: (Int32Array | null)[] = new Array(numSquares).fill(null);
    const w = new DenseWorkingCol(numEdges);

    for (let ci = 0; ci < numSquares; ci++) {
      const sq = squares[ci]!;
      w.loadFromNumbers(sq.edges);
      while (true) {
        const pivot = w.pivot();
        if (pivot < 0) break;
        const prev = h1Pivots[pivot]!;
        if (prev < 0) {
          h1Pivots[pivot] = ci;
          h1reduced[ci] = w.toSparse();
          h1Pairs.push({ birth: edges[pivot]!.val, death: sq.val, dim: 1 });
          break;
        }
        const prevCol = h1reduced[prev]!;
        if (prevCol === null) break;
        w.xorSparse(prevCol);
      }
    }

    for (let ei = 0; ei < numEdges; ei++) {
      if (cycleEdges[ei] && h1Pivots[ei]! < 0) {
        h1Pairs.push({ birth: edges[ei]!.val, death: -1, dim: 1 });
      }
    }
  }

  return {
    pairs: [...h0Pairs, ...h1Pairs],
    dims: { height, width },
  };
}

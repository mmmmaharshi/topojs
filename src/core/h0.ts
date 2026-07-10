import { UnionFind } from './unionfind.ts';

/**
 * A single persistence pair: a homological feature that is born at
 * filtration value `birth` and dies at `death`.  death = -1 indicates
 * an essential (infinite) class that never dies.
 *
 * For H₀ classes, birth = 0.
 * For H₁ classes, birth = edge birth value, death = triangle death value.
 * For H₂ classes, birth = triangle birth value, death = tetrahedron death value.
 */
export interface PersistencePair {
  birth: number;
  death: number;
  dim: number;
}

/** An edge (1-simplex) in the Vietoris–Rips complex. */
export interface EdgeEntry {
  u: number;
  v: number;
  val: number;
}

/**
 * Compute H₀ persistence via union–find.
 *
 * Processes edges in filtration order (sorted by value).
 * Each edge connecting two previously separate components
 * produces a death event at the edge's filtration value.
 * The single remaining component at the end is essential.
 *
 * Time: O(|E| α(n)) where α is the inverse Ackermann function.
 * Space: O(n) for the union–find structure.
 */
export function computeH0(nVertices: number, edges: EdgeEntry[]): PersistencePair[] {
  const uf = new UnionFind(nVertices);
  const pairs: PersistencePair[] = [];

  for (const { u, v, val } of edges) {
    const ru = uf.find(u);
    const rv = uf.find(v);
    if (ru !== rv) {
      pairs.push({ birth: 0, death: val, dim: 0 });
      uf.union(u, v);
    }
  }

  return pairs;
}

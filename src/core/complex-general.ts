import type { Points } from "./distance.ts";
import type { EdgeEntry } from "./h0.ts";

function euclidean(points: Points, dims: number, i: number, j: number): number {
  const bi = i * dims;
  const bj = j * dims;
  let sq = 0;
  for (let d = 0; d < dims; d++) {
    const diff = points[bi + d]! - points[bj + d]!;
    sq += diff * diff;
  }
  return Math.sqrt(sq);
}

/**
 * A k-simplex (k >= 2) in the general (arbitrary-dimension) Rips complex.
 * Edges (k=1) are represented separately as {@link EdgeEntry} (reusing the
 * exact engine's type) since dimension-0/1 boundary is handled by
 * `computeH0Phase`, not this file's generalized reduction.
 */
export interface GeneralSimplexEntry {
  /** Sorted vertex indices, length = dimension + 1. */
  verts: Int32Array;
  /**
   * Indices into the PREVIOUS level's array (dimension - 1), one per face,
   * in "omit vertex i" order (face[i] = the (dim-1)-simplex obtained by
   * removing verts[i]). Length = verts.length.
   */
  faces: Int32Array;
  /** Filtration value = max pairwise distance among verts. */
  val: number;
}

/**
 * The Vietoris–Rips complex up to an ARBITRARY dimension, generalizing
 * `buildRipsComplex` (src/core/complex.ts, which hardcodes 3 levels: edges,
 * triangles, tetrahedra) to `maxSimplexDim` levels via the same bit-vector
 * adjacency-intersection technique, applied in a loop instead of unrolled
 * per dimension.
 *
 * ALGORITHM (identical in spirit to buildRipsComplex's triangle/tetrahedron
 * loops, just parameterized by dimension): a (k+1)-vertex k-simplex is
 * extended to a (k+2)-vertex (k+1)-simplex by finding common neighbors --
 * vertices adjacent to EVERY vertex already in the simplex -- via ANDing
 * together all k+1 adjacency bitsets, restricted to candidates greater than
 * the simplex's largest vertex (avoids re-discovering the same simplex via
 * a different starting face). A new simplex's filtration value is
 * max(parent simplex's value, distance from the new vertex to every
 * existing vertex) -- the only NEW edges introduced are those to the new
 * vertex, so this is exact, not an approximation, matching
 * buildRipsComplex's identical reasoning for triangles/tetrahedra.
 *
 * FACE LOOKUP: each new k-simplex's boundary is k+1 faces (omit one vertex
 * each). The face obtained by omitting the LARGEST vertex is exactly the
 * parent (k-1)-simplex being extended -- no lookup needed, same shortcut
 * buildRipsComplex already uses for tetrahedra's 4th face. The other k
 * faces need a lookup by vertex-tuple into the previous level's array; this
 * file uses a `Map<bigint, number>` keyed by a base-n positional encoding
 * of the sorted vertex tuple (BigInt, not a string, to avoid the measured
 * string-Map overhead that motivated replacing SpatialGrid's string keys
 * with packed numeric ones -- see spatial-grid.ts's class docstring for
 * that precedent). A plain number key would overflow/collide for
 * high-dimension tuples at realistic n, hence BigInt rather than the
 * `u*n+v` pattern buildRipsComplex uses for its fixed 2-3 vertex keys.
 *
 * SCOPE, stated honestly: this is a CORRECTNESS-first generalization, not a
 * performance-tuned one. It deliberately does NOT reuse buildRipsComplex's
 * spatial-grid edge-building optimization (src/core/spatial-grid.ts) --
 * edges here are always brute-force O(n^2). This is a reasonable first-cut
 * scope limit (see this module's introduction in the project history for
 * why: it exists to make dimension >= 3 homology computable AT ALL, which
 * this repo's other engines cannot do regardless of n, not to make it fast
 * at the n this repo's exact engines already handle well). Simplex counts
 * at dimension k grow combinatorially with n and density in the worst case
 * (O(n^(k+1))) -- this is inherent to flag complexes, not a shortcut taken
 * here; practical use is small-to-moderate n and maxSimplexDim, same
 * regime pitch A's sparse-rips.ts targets from the opposite direction (n
 * too large) -- combining the two is a natural follow-up, out of scope here.
 *
 * @param points Flattened coordinates, length n*dims
 * @param dims Number of dimensions per point
 * @param maxDist Vietoris–Rips threshold epsilon
 * @param maxSimplexDim Highest simplex dimension to build (>= 1). To
 *   compute H_j, faces up to dimension j+1 must be built, i.e. pass at
 *   least j+1 (matching buildRipsComplex's maxDim convention: maxDim=3
 *   there means "build tetrahedra", enabling H2).
 */
export interface GeneralRipsComplex {
  n: number;
  /** levels[0] is unused (vertices are implicit 0..n-1). levels[1] = edges. levels[k] for k>=2 = GeneralSimplexEntry[]. */
  edgeLevel: EdgeEntry[];
  higherLevels: GeneralSimplexEntry[][]; // higherLevels[0] = dim-2 simplices (triangles), higherLevels[1] = dim-3, ...
}

function encodeKey(verts: Int32Array | number[], n: number): bigint {
  let key = 0n;
  const N = BigInt(n);
  for (const v of verts) {
    key = key * N + BigInt(v);
  }
  return key;
}

export function buildGeneralRipsComplex(
  points: Points,
  dims: number,
  maxDist: number,
  maxSimplexDim: number,
): GeneralRipsComplex {
  const n = points.length / dims;

  if (maxSimplexDim < 1) {
    throw new RangeError(`maxSimplexDim must be >= 1, got ${maxSimplexDim}`);
  }

  // ── Level 1: edges (brute force -- see this file's SCOPE note) ──
  const tempEdges: { u: number; v: number; val: number; origIdx: number }[] = [];
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = euclidean(points, dims, i, j);
      if (d <= maxDist) {
        tempEdges.push({ origIdx: adj[i]!.length, u: i, v: j, val: d });
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }
  }
  tempEdges.sort((a, b) => a.val - b.val || a.origIdx - b.origIdx);
  const edgeLevel: EdgeEntry[] = tempEdges.map((e) => ({ u: e.u, v: e.v, val: e.val }));

  const edgeIndex = new Map<bigint, number>();
  for (let i = 0; i < edgeLevel.length; i++) {
    const e = edgeLevel[i]!;
    edgeIndex.set(encodeKey([e.u, e.v], n), i);
  }

  for (let v = 0; v < n; v++) {
    adj[v]!.sort((a, b) => a - b);
  }
  const words = Math.ceil(n / 32);
  const adjBits: Uint32Array[] = Array.from({ length: n });
  for (let v = 0; v < n; v++) {
    const bits = new Uint32Array(words);
    for (const nb of adj[v]!) {
      bits[nb >>> 5]! |= 1 << (nb & 31);
    }
    adjBits[v] = bits;
  }

  if (maxSimplexDim === 1) {
    return { edgeLevel, higherLevels: [], n };
  }

  // ── Levels 2..maxSimplexDim, generalizing buildRipsComplex's
  // triangle/tetrahedron loops into one loop over dimension. ──
  const higherLevels: GeneralSimplexEntry[][] = [];
  // prevVerts/prevVal/prevBits track the previous level for extension;
  // prevIndex maps that level's vertex-tuple -> its own index (for the
  // level AFTER it to look up non-parent faces).
  let prevLevel: { verts: Int32Array; val: number }[] = edgeLevel.map((e) => ({
    val: e.val,
    verts: Int32Array.from([e.u, e.v]),
  }));
  let prevIndex = edgeIndex;

  for (let dim = 2; dim <= maxSimplexDim; dim++) {
    const thisLevel: GeneralSimplexEntry[] = [];
    const numVerts = dim + 1;

    for (let si = 0; si < prevLevel.length; si++) {
      const parent = prevLevel[si]!;
      const pv = parent.verts;
      const top = pv.at(-1)!;

      // AND together every vertex's adjacency bitset to find common neighbors.
      let bits: Uint32Array | null = null;
      for (const pvv of pv) {
        const b = adjBits[pvv]!;
        if (bits === null) {
          bits = b.slice();
        } else {
          for (let w = 0; w < words; w++) {
            bits[w]! &= b[w]!;
          }
        }
      }
      const startWord = (top + 1) >>> 5;
      const startBit = (top + 1) & 31;

      for (let w = startWord; w < words; w++) {
        let word = bits![w]!;
        if (w === startWord && startBit > 0) {
          word &= ~((1 << startBit) - 1);
        }
        while (word) {
          const lsb = word & -word;
          const bit = Math.clz32(lsb) ^ 31;
          const x = (w << 5) + bit;
          word ^= lsb;

          const newVerts = new Int32Array(numVerts);
          newVerts.set(pv, 0);
          newVerts[numVerts - 1] = x;

          // New edges introduced by x: (verts[i], x) for every existing
          // vertex -- val is the max of the parent's own val and these.
          let { val } = parent;
          for (const pvi of pv) {
            const d = euclidean(points, dims, pvi, x);
            if (d > val) {
              val = d;
            }
          }

          // Faces: omitting the LAST vertex (x) is the parent itself
          // (no lookup); omitting any earlier vertex needs a lookup into
          // prevIndex by the resulting (numVerts-1)-tuple.
          const faces = new Int32Array(numVerts);
          for (let omit = 0; omit < numVerts - 1; omit++) {
            const faceVerts: number[] = [];
            for (let vi = 0; vi < numVerts; vi++) {
              if (vi !== omit) {
                faceVerts.push(newVerts[vi]!);
              }
            }
            const key = encodeKey(faceVerts, n);
            const idx = prevIndex.get(key);
            // idx is always found: faceVerts is a sub-clique of the
            // already-verified clique {pv..., x}, so it was necessarily
            // discovered as its own simplex at the previous level (every
            // face of a flag-complex clique is itself a clique).
            faces[omit] = idx!;
          }
          faces[numVerts - 1] = si; // parent, the "omit x" face

          thisLevel.push({ faces, val, verts: newVerts });
        }
      }
    }

    thisLevel.sort((a, b) => a.val - b.val);
    higherLevels.push(thisLevel);

    // Build this level's index for the NEXT iteration's face lookups.
    const nextIndex = new Map<bigint, number>();
    for (let i = 0; i < thisLevel.length; i++) {
      nextIndex.set(encodeKey(thisLevel[i]!.verts, n), i);
    }
    prevLevel = thisLevel.map((s) => ({ val: s.val, verts: s.verts }));
    prevIndex = nextIndex;
  }

  return { edgeLevel, higherLevels, n };
}

import type { PersistencePair } from './h0.ts';

/**
 * Compute the L∞ bottleneck distance between two persistence diagrams.
 *
 * Uses the standard formulation: for each dimension d, match finite
 * persistence pairs (birth, death) with those in the other diagram,
 * allowing unmatched points to be matched to the diagonal.
 *
 * Algorithm: binary search on the matching threshold ε (0 to maxEps),
 * with each feasibility check solved via DFS-based bipartite matching
 * (Kuhn–Munkres / Hungarian variant on the ε-adjacency graph).
 *
 * Time: O(N · (n + m) · log(maxEps / tol)) per dimension, where
 *   N = match attempts × DFS visits ≈ O(n · m) worst-case
 *   n,m = number of finite pairs in each diagram
 *
 * The binary search converges in log₂(maxEps / tol) ≈ 40 iterations
 * for standard tolerances.
 *
 * Space: O(n + m) for adjacency lists and match arrays.
 */

function supNorm(a: [number, number], b: [number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

function toDiagonal(p: [number, number]): [number, number] {
  const mid = (p[0] + p[1]) / 2;
  return [mid, mid];
}

function cost(a: [number, number], b: [number, number]): number {
  return supNorm(a, b);
}

function costToDiagonal(p: [number, number]): number {
  return Math.abs(p[1] - p[0]) / 2;
}

function matchesExist(
  D1: [number, number][],
  D2: [number, number][],
  eps: number,
): boolean {
  const n = D1.length;
  const m = D2.length;
  const total = n + m;

  // Build bipartite adjacency: D1 nodes [0..n-1], D2 nodes [n..n+m-1], diagonal nodes
  // Use DFS-based bipartite matching

  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (cost(D1[i]!, D2[j]!) <= eps) {
        adj[i]!.push(j);
      }
    }
    if (costToDiagonal(D1[i]!) <= eps) {
      adj[i]!.push(m); // diagonal sentinel
    }
  }

  const matchR = new Int32Array(m + 1).fill(-1);

  function dfs(u: number, seen: Uint8Array): boolean {
    for (const v of adj[u]!) {
      if (v === m) {
        if (!seen[m]) {
          seen[m] = 1;
          return true;
        }
        continue;
      }
      if (seen[v]) continue;
      seen[v] = 1;
      if (matchR[v]! < 0 || dfs(matchR[v]!, seen)) {
        matchR[v] = u;
        return true;
      }
    }
    return false;
  }

  let matched = 0;
  for (let i = 0; i < n; i++) {
    const seen = new Uint8Array(m + 1);
    if (dfs(i, seen)) matched++;
  }

  return matched === n;
}

export function bottleneckDistance(
  pairsA: PersistencePair[],
  pairsB: PersistencePair[],
  dim: number = 0,
  maxEps: number = 1e6,
  tol: number = 1e-6,
): number {
  const d1 = pairsA
    .filter(p => p.dim === dim && p.death >= 0)
    .map(p => [p.birth, p.death] as [number, number]);
  const d2 = pairsB
    .filter(p => p.dim === dim && p.death >= 0)
    .map(p => [p.birth, p.death] as [number, number]);

  if (d1.length === 0 && d2.length === 0) return 0;
  if (d1.length === 0 || d2.length === 0) return Infinity;

  let lo = 0;
  let hi = maxEps;

  if (!matchesExist(d1, d2, hi)) return Infinity;
  if (matchesExist(d1, d2, lo)) return 0;

  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    if (matchesExist(d1, d2, mid)) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return hi;
}

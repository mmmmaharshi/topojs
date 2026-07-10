import { Worker } from 'worker_threads';
import { cpus } from 'os';
import type { Points } from '../core/distance.ts';
import { computePairwiseDistances, lookupDist } from '../core/distance.ts';
import type { EdgeEntry } from '../core/h0.ts';
import type { TriangleEntry, TetraEntry } from '../core/complex.ts';

function edgeKey(u: number, v: number, n: number): number {
  return u * n + v;
}

function triKey(u: number, v: number, w: number, n: number): number {
  return (u * n + v) * n + w;
}

function makeWorkerSrc(): string {
  return `
const { parentPort } = require('worker_threads');

parentPort.on('message', (msg) => {
  const { edges, adjBits, words, n, edgeMapArr, distFlat } = msg;
  const edgeMap = new Map(edgeMapArr);
  const tris = [];

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const sw = (e.v + 1) >>> 5, sb = (e.v + 1) & 31;
    for (let w = sw; w < words; w++) {
      let bits = adjBits[e.u * words + w] & adjBits[e.v * words + w];
      if (w === sw && sb > 0) bits &= ~((1 << sb) - 1);
      while (bits) {
        const lsb = bits & -bits;
        const k = (w << 5) + (Math.clz32(lsb) ^ 31);
        bits ^= lsb;
        const a = e.u < k ? e.u : k, c = e.u < k ? k : e.u;
        const dik = distFlat[a * n - ((a + 1) * (a + 2)) / 2 + c];
        const b = e.v < k ? e.v : k, d = e.v < k ? k : e.v;
        const djk = distFlat[b * n - ((b + 1) * (b + 2)) / 2 + d];
        tris.push([
          edgeMap.get(e.u * n + e.v),
          edgeMap.get(e.u * n + k),
          edgeMap.get(e.v * n + k),
          Math.max(e.val, dik, djk),
        ]);
      }
    }
  }
  parentPort.postMessage({ tris });
});
`;
}

export async function buildRipsParallel(
  points: Points,
  dims: number,
  maxDist: number,
  maxDim: number = 2,
  numWorkers: number = 0,
) {
  const n = points.length / dims;
  const dist = computePairwiseDistances(points, dims, n);

  const tempEdges: { u: number; v: number; val: number; origIdx: number }[] = [];
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = lookupDist(dist, i, j);
      if (d <= maxDist) {
        tempEdges.push({ u: i, v: j, val: d, origIdx: adj[i]!.length });
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }
  }

  tempEdges.sort((a, b) => a.val - b.val || a.origIdx - b.origIdx);

  const edges: EdgeEntry[] = tempEdges.map(e => ({ u: e.u, v: e.v, val: e.val }));
  const edgeMap = new Map<number, number>();
  for (let i = 0; i < edges.length; i++) {
    edgeMap.set(edgeKey(edges[i]!.u, edges[i]!.v, n), i);
  }

  for (let v = 0; v < n; v++) adj[v]!.sort((a, b) => a - b);

  const words = Math.ceil(n / 32);
  const adjBits = new Uint32Array(n * words);
  for (let v = 0; v < n; v++) {
    const nbors = adj[v]!;
    for (let k = 0; k < nbors.length; k++) {
      const idx = nbors[k]!;
      adjBits[v * words + (idx >>> 5)]! |= 1 << (idx & 31);
    }
  }

  const distN = (n * (n - 1)) / 2;
  const distFlat = new Float64Array(distN);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      distFlat[i * n - ((i + 1) * (i + 2)) / 2 + j] = lookupDist(dist, i, j);
    }
  }

  const numCpus = numWorkers > 0 ? numWorkers : Math.min(cpus().length, Math.ceil(edges.length / 10) || 1);
  const chunkSize = Math.ceil(edges.length / numCpus);

  const edgeMapArr: [number, number][] = Array.from(edgeMap.entries());

  const workerSrc = makeWorkerSrc();
  const workerPromises: Promise<{ tris: number[][] }>[] = [];

  for (let w = 0; w < numCpus; w++) {
    const start = w * chunkSize;
    const end = Math.min(start + chunkSize, edges.length);
    if (start >= edges.length) break;

    const chunkEdges = edges.slice(start, end).map(e => ({ u: e.u, v: e.v, val: e.val }));

    workerPromises.push(new Promise((resolve, reject) => {
      const worker = new Worker(workerSrc, { eval: true });
      worker.on('message', (msg) => { resolve(msg); worker.terminate(); });
      worker.on('error', reject);
      worker.postMessage({
        edges: chunkEdges,
        adjBits: adjBits,
        words, n, edgeMapArr, distFlat,
      });
    }));
  }

  const results = await Promise.all(workerPromises);

  const triangles: TriangleEntry[] = [];
  for (const r of results) {
    for (const t of r.tris) {
      triangles.push({
        edges: [t[0]!, t[1]!, t[2]!],
        verts: [0, 0, 0],
        val: t[3]!,
      });
    }
  }

  triangles.sort((a, b) => a.val - b.val);

  for (let ti = 0; ti < triangles.length; ti++) {
    const t = triangles[ti]!;
    const e0 = edges[t.edges[0]!]!;
    const e1 = edges[t.edges[1]!]!;
    const vs = new Set([e0.u, e0.v, e1.u, e1.v]);
    t.verts = Array.from(vs) as [number, number, number];
  }

  const triMap = new Map<number, number>();
  for (let ti = 0; ti < triangles.length; ti++) {
    const [tu, tv, tw] = triangles[ti]!.verts;
    triMap.set(triKey(tu, tv, tw, n), ti);
  }

  const tetrahedra: TetraEntry[] = [];
  if (maxDim >= 3) {
    for (let ti = 0; ti < triangles.length; ti++) {
      const [su, sv, sw] = triangles[ti]!.verts;
      const triVal = triangles[ti]!.val;
      const swd = (sw + 1) >>> 5;
      const sbit = (sw + 1) & 31;

      for (let wd = swd; wd < words; wd++) {
        let bits = adjBits[su * words + wd]! & adjBits[sv * words + wd]! & adjBits[sw * words + wd]!;
        if (wd === swd && sbit > 0) bits &= ~((1 << sbit) - 1);
        while (bits) {
          const lsb = bits & -bits;
          const bit = Math.clz32(lsb) ^ 31;
          const x = (wd << 5) + bit;
          bits ^= lsb;
          tetrahedra.push({
            triangles: [
              triMap.get(triKey(sv, sw, x, n))!,
              triMap.get(triKey(su, sw, x, n))!,
              triMap.get(triKey(su, sv, x, n))!,
              ti,
            ],
            val: Math.max(triVal, lookupDist(dist, su, x), lookupDist(dist, sv, x), lookupDist(dist, sw, x)),
          });
        }
      }
    }
    tetrahedra.sort((a, b) => a.val - b.val);
  }

  return { n, edges, triangles, tetrahedra };
}

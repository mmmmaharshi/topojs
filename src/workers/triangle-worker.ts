import { parentPort } from 'worker_threads';

function lk(i: number, j: number, n: number, distFlat: Float64Array): number {
  if (i === j) return 0;
  const a = i < j ? i : j;
  const b = i < j ? j : i;
  return distFlat[a * n - ((a + 1) * (a + 2)) / 2 + b]!;
}

if (parentPort) {
  parentPort.on('message', (msg: {
    edges: { u: number; v: number; val: number }[];
    adjBits: Uint32Array;
    words: number;
    n: number;
    edgeMapArr: [number, number][];
    distFlat: Float64Array;
    startIdx: number;
  }) => {
    const { edges, adjBits, words, n, edgeMapArr, distFlat, startIdx } = msg;
    const edgeMap = new Map<number, number>(edgeMapArr);
    const triangles: number[][] = [];

    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei]!;
      const sw = (e.v + 1) >>> 5;
      const sb = (e.v + 1) & 31;

      for (let w = sw; w < words; w++) {
        let bits = adjBits[e.u * words + w]! & adjBits[e.v * words + w]!;
        if (w === sw && sb > 0) bits &= ~((1 << sb) - 1);
        while (bits) {
          const lsb = bits & -bits;
          const k = (w << 5) + (Math.clz32(lsb) ^ 31);
          bits ^= lsb;
          triangles.push([
            edgeMap.get(e.u * n + e.v)!,
            edgeMap.get(e.u * n + k)!,
            edgeMap.get(e.v * n + k)!,
            Math.max(e.val, lk(e.u, k, n, distFlat), lk(e.v, k, n, distFlat)),
          ]);
        }
      }
    }
    parentPort!.postMessage({ triangles, startIdx });
  });
}

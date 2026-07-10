/**
 * TopoJS comparison runner — called by bench/comparison.py
 * Reads point cloud config from command-line args, prints JSON result.
 * Usage: node bench/comparison.ts <n> <dims> <eps> <maxdim> <json_array_of_points>
 */
import { computePersistentHomology } from '../src/core/homology.ts';

const n = parseInt(process.argv[1]!);
const dims = parseInt(process.argv[2]!);
const eps = parseFloat(process.argv[3]!);
const maxdim = parseInt(process.argv[4]!);
const ptsJson = process.argv[5]!;

const flat = JSON.parse(ptsJson) as number[];
const pts = new Float64Array(flat);

const times: number[] = [];
let h0 = 0, h1 = 0;

for (let r = 0; r < 3; r++) {
  const t0 = performance.now();
  const res = computePersistentHomology(pts, dims, eps, maxdim);
  const dt = performance.now() - t0;
  times.push(dt);
  h0 = res.pairs.filter(p => p.dim === 0).length;
  h1 = res.pairs.filter(p => p.dim === 1).length;
}

const mean = times.reduce((a, b) => a + b, 0) / times.length;
const std = Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length);
process.stdout.write(JSON.stringify({ mean, std, h0, h1 }));

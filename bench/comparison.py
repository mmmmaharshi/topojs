"""
TopoJS vs Ripser -- Comparison Benchmark
========================================
Compares runtime and results on identical random point clouds.
Ripser via ripser.py (C++ backend), TopoJS via Node.js subprocess.

Benchmarks BOTH the naive ground truth (computePersistentHomology) and the
cohomology-accelerated H1 path (computePersistentHomologyCohomology), so the
table shows honestly how much of the gap to real, optimized Ripser the
cohomology work closes -- and how much remains (Ripser also uses implicit
enumeration, clearing, and apparent+emergent pairs together across ALL
dimensions, which this project does not fully replicate).

Usage: python bench/comparison.py
"""

import subprocess
import json
import time
import os
import numpy as np
from ripser import ripser

# Generate test point clouds
np.random.seed(42)
test_cases = [
    {"name": "circle_30", "pts": np.column_stack([np.cos(np.linspace(0, 2*np.pi, 30, endpoint=False)),
                                                   np.sin(np.linspace(0, 2*np.pi, 30, endpoint=False))]), "eps": 1.5, "maxdim": 2},
    {"name": "random_50_2d", "pts": np.random.rand(50, 2), "eps": 0.5, "maxdim": 2},
    {"name": "random_100_2d", "pts": np.random.rand(100, 2), "eps": 0.3, "maxdim": 2},
    {"name": "random_100_2d_dense", "pts": np.random.rand(100, 2), "eps": 0.8, "maxdim": 2},
    {"name": "random_150_3d", "pts": np.random.rand(150, 3), "eps": 1.0, "maxdim": 2},
    {"name": "random_300_2d_dense", "pts": np.random.rand(300, 2), "eps": 0.3, "maxdim": 2},
]

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNNER = os.path.join(BASE, "runner_temp.mjs")

# Runner benchmarks BOTH functions on the same input, reusing the same
# random seed's data (passed in via file) so the comparison is apples-to-apples.
runner_code = """import { readFileSync } from 'fs';
import { computePersistentHomology } from './src/core/homology.ts';
import { computePersistentHomologyCohomology } from './src/core/homology-cohom.ts';

const dataPath = process.argv[2];
const raw = readFileSync(dataPath, 'utf-8');
const cfg = JSON.parse(raw);
const pts = new Float64Array(cfg.points);
const { dims, eps, maxdim } = cfg;

function bench(fn) {
  const times = [];
  let h0 = 0, h1 = 0;
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    const res = fn(pts, dims, eps, maxdim);
    const dt = performance.now() - t0;
    times.push(dt);
    h0 = res.pairs.filter(p => p.dim === 0).length;
    h1 = res.pairs.filter(p => p.dim === 1).length;
  }
  const mean = times.reduce((a,b)=>a+b,0)/times.length;
  const std = Math.sqrt(times.reduce((a,b)=>a+(b-mean)**2,0)/times.length);
  return { mean, std, h0, h1 };
}

const naive = bench(computePersistentHomology);
const cohom = bench(computePersistentHomologyCohomology);
console.log(JSON.stringify({ naive, cohom }));
"""

with open(RUNNER, 'w') as f:
    f.write(runner_code)

print("=" * 100)
print("  TopoJS vs Ripser -- Comparison Benchmark (naive ground truth AND cohomology H1)")
print("  Ripser version: ripser.py")
print("  Date: " + time.strftime("%Y-%m-%d"))
print("=" * 100)
print()
print(f"{'Case':<22} {'n':>4} {'d':>2} {'eps':>5} {'Ripser':>10} {'TopoJS-naive':>13} {'TopoJS-cohom':>13} {'naive x':>8} {'cohom x':>8}  {'Match':>6}")
print("-" * 100)

for tc in test_cases:
    name = tc["name"]
    pts = tc["pts"]
    eps = tc["eps"]
    maxdim = tc["maxdim"]
    n, d = pts.shape

    ripser_times = []
    result = None
    for run in range(3):
        t0 = time.perf_counter()
        result = ripser(pts, distance_matrix=False, thresh=eps, maxdim=maxdim-1)
        dt = time.perf_counter() - t0
        ripser_times.append(dt * 1000)

    ripser_mean = np.mean(ripser_times)
    ripser_std = np.std(ripser_times)

    ripser_h0 = ripser_h1 = None
    if result is not None and 'dgms' in result and len(result['dgms']) > 0:
        dgm0 = result['dgms'][0]
        dgm1 = result['dgms'][1] if len(result['dgms']) > 1 else []
        ripser_h0 = len(dgm0)
        ripser_h1 = len(dgm1)

    config = {
        "points": pts.flatten().tolist(),
        "dims": d,
        "eps": eps,
        "maxdim": maxdim
    }
    data_path = os.path.join(BASE, "bench", "temp_data.json")
    with open(data_path, 'w') as f:
        json.dump(config, f)

    try:
        proc = subprocess.run(
            ["node", "--experimental-transform-types", RUNNER, data_path],
            cwd=BASE,
            capture_output=True, text=True, timeout=120
        )

        topojs_data = None
        for line in proc.stdout.split('\n'):
            line = line.strip()
            if line.startswith('{') and 'naive' in line:
                try:
                    topojs_data = json.loads(line)
                    break
                except json.JSONDecodeError:
                    pass

        if topojs_data:
            naive = topojs_data["naive"]
            cohom = topojs_data["cohom"]

            naive_ratio = naive["mean"] / ripser_mean if ripser_mean > 0 else float('inf')
            cohom_ratio = cohom["mean"] / ripser_mean if ripser_mean > 0 else float('inf')
            h0_match = "OK" if ripser_h0 == naive["h0"] == cohom["h0"] else f"X({ripser_h0}/{naive['h0']}/{cohom['h0']})"
            h1_match = "OK" if ripser_h1 == naive["h1"] == cohom["h1"] else f"X({ripser_h1}/{naive['h1']}/{cohom['h1']})"
            match_str = h0_match if h0_match != "OK" else h1_match

            r_str = f"{ripser_mean:.1f}+-{ripser_std:.1f}"
            n_str = f"{naive['mean']:.1f}+-{naive['std']:.1f}"
            c_str = f"{cohom['mean']:.1f}+-{cohom['std']:.1f}"
            print(f"{name:<22} {n:>4} {d:>2} {eps:>5.1f} {r_str:>10} {n_str:>13} {c_str:>13}"
                  f" {naive_ratio:>7.1f}x {cohom_ratio:>7.1f}x  {match_str:>6}")
        else:
            err = proc.stderr[:150] if proc.stderr else "no JSON output"
            print(f"{name:<22} {n:>4} {d:>2} {eps:>5.1f} {'ERR':>10} {err}")

    except subprocess.TimeoutExpired:
        print(f"{name:<22} {n:>4} {d:>2} {eps:>5.1f} {'TIMEOUT':>10}")
    except Exception as e:
        print(f"{name:<22} {n:>4} {d:>2} {eps:>5.1f} {'ERROR':>10} {str(e)[:80]}")

    if os.path.exists(data_path):
        try:
            os.unlink(data_path)
        except OSError:
            pass  # best-effort cleanup; some sandboxed/synced filesystems disallow delete

if os.path.exists(RUNNER):
    try:
        os.unlink(RUNNER)
    except OSError:
        pass  # best-effort cleanup; some sandboxed/synced filesystems disallow delete
print("-" * 100)
print()
print("Interpretation: 'naive x' / 'cohom x' are how many times SLOWER than real Ripser each")
print("TopoJS path is (1.0x would mean parity). Ripser also uses implicit simplex enumeration,")
print("clearing, and apparent+emergent pairs together across ALL dimensions -- this project's")
print("cohomology work only accelerates H1 via the coboundary direction, so a real, honest gap")
print("to the state of the art is expected to remain. Report both ratios, not just one.")

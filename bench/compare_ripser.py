#!/usr/bin/env python3
"""
Cross-check topojs's batch Vietoris-Rips engine (computePersistentHomology)
against Ripser (Bauer 2019/2021, https://arxiv.org/abs/1908.02518), the
established state-of-the-art C++ reference implementation, on the SAME real
point clouds already used elsewhere in this repo's benchmarks (real sunspot
and Melbourne-temperature data, delay-embedded exactly as bench/benchmark.ts
does it).

This is a correctness cross-check (do the Betti numbers / pair counts per
dimension match?) plus an honest speed reference point (topojs is a pure-JS
educational/research implementation; Ripser is a heavily optimized C++ tool
Bauer's own paper shows is 40x+ faster than GUDHI/Dionysus/PHAT/Perseus --
this script does not expect topojs to win on speed, and reports whatever it
measures either way).

GUDHI was attempted too (pip install gudhi) but has no manylinux wheel for
this sandbox's architecture (aarch64) and no conda available to build it
from source, so it is not included here -- Ripser alone is used as the
comparison partner, which the Ripser paper itself establishes as the fastest
of the batch tools it compared against.

Run with: python3 bench/compare_ripser.py
Requires: pip install --break-system-packages ripser numpy
"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from ripser import ripser

HERE = Path(__file__).parent
DATA = HERE / "data"
# Scratch files go in the system temp dir, not bench/, so a failed/interrupted
# run never leaves stray artifacts in the repo (previously used bench/_tmp_*,
# which is harmless -- .gitignore'd -- but still repo clutter on cleanup
# failure, e.g. read-only/restricted mounts where unlink() can fail).
TMPDIR = Path(tempfile.mkdtemp(prefix="topojs_ripser_cmp_"))


def autocorrelation(series: np.ndarray, lag: int) -> float:
    n = len(series)
    mean = series.mean()
    num = np.sum((series[: n - lag] - mean) * (series[lag:] - mean))
    den = np.sum((series - mean) ** 2)
    return num / den


def data_driven_lag(series: np.ndarray, max_scan: int, fallback: int) -> int:
    threshold = 1 / np.e
    lag = 1
    for l in range(1, max_scan + 1):
        if autocorrelation(series, l) < threshold and lag == 1 and l > 1:
            lag = l
    return lag if lag != 1 else fallback


def delay_embed_2d(series: np.ndarray, lag: int) -> np.ndarray:
    mn, mx = series.min(), series.max()
    norm = (series - mn) / (mx - mn)
    n = len(series) - lag
    pts = np.stack([norm[:n], norm[lag : lag + n]], axis=1)
    return pts


def load_sunspots() -> np.ndarray:
    lines = (DATA / "monthly-sunspots.csv").read_text().strip().split("\n")[1:]
    vals = np.array([float(line.split(",")[1].strip('"')) for line in lines])
    lag = data_driven_lag(vals, 40, 6)
    return delay_embed_2d(vals, lag)


def load_melbourne() -> np.ndarray:
    lines = (DATA / "daily-min-temperatures.csv").read_text().strip().split("\n")[1:]
    vals = np.array([float(line.split(",")[1].strip('"')) for line in lines])
    lag = data_driven_lag(vals, 60, 10)
    return delay_embed_2d(vals, lag)


def betti_summary(dgms, maxdim: int) -> dict:
    out = {}
    for d in range(maxdim + 1):
        dgm = dgms[d]
        finite = int(np.sum(np.isfinite(dgm[:, 1])))
        essential = int(np.sum(~np.isfinite(dgm[:, 1])))
        out[str(d)] = {"finite": finite, "essential": essential}
    return out


def run_case(name: str, points: np.ndarray, max_dist: float, max_dim: int) -> None:
    n = len(points)
    print(f"\n=== {name}: n={n} points, maxDist={max_dist}, maxDim={max_dim} ===")

    # -- Ripser --
    t0 = time.perf_counter()
    result = ripser(points, maxdim=max_dim, thresh=max_dist)
    ripser_ms = (time.perf_counter() - t0) * 1000
    ripser_betti = betti_summary(result["dgms"], max_dim)
    print(f"ripser (C++, state-of-the-art batch reference): {ripser_ms:.2f}ms  byDim={ripser_betti}")

    # -- topojs (via Node subprocess, exact same point cloud) --
    csv_path = TMPDIR / f"{name}.csv"
    out_path = TMPDIR / f"{name}_result.json"
    np.savetxt(csv_path, points, fmt="%.10f")
    # NOTE on convention mismatch: ripser's `maxdim` is the highest HOMOLOGY
    # dimension to compute (2 = H0+H1+H2). topojs's computePersistentHomology
    # `maxDim` is the highest SIMPLEX dimension to construct -- per its own
    # docstring, maxDim=1 and maxDim=2 both mean "H0+H1 only"; you must pass
    # maxDim=3 (tetrahedra) to get H2 at all. This tripped up the first run
    # of this script (saw a real-looking "topojs missed an H2 class"
    # mismatch that was actually just this off-by-one in API convention, not
    # an algorithm bug) -- documented here so it isn't silently "fixed" by
    # coincidence again.
    topojs_max_dim = max_dim + 1 if max_dim >= 2 else max_dim
    subprocess.run(
        [
            "node", "--experimental-transform-types",
            str(HERE / "export_topojs_diagram.ts"),
            str(csv_path), "2", str(max_dist), str(topojs_max_dim), str(out_path),
        ],
        check=True, capture_output=True, text=True,
    )
    topojs_result = json.loads(out_path.read_text())
    print(f"topojs (pure JS, this repo): {topojs_result['ms']:.2f}ms  byDim={topojs_result['byDim']}")

    # -- compare --
    match = True
    for d in range(max_dim + 1):
        t_finite = topojs_result["byDim"][str(d)]["finite"]
        t_essential = topojs_result["byDim"][str(d)]["essential"]
        r_finite = ripser_betti[str(d)]["finite"]
        r_essential = ripser_betti[str(d)]["essential"]
        if (t_finite, t_essential) != (r_finite, r_essential):
            match = False
            print(f"  MISMATCH at dim {d}: topojs finite={t_finite} essential={t_essential}  "
                  f"ripser finite={r_finite} essential={r_essential}")
    print(f"Betti-number match across all dims: {'YES' if match else 'NO'}")

    # -- reconcile via zero-persistence-bar convention, if raw counts mismatched --
    # Root-caused (see docs/COMPARISON.md "The one real mismatch, root-caused"):
    # coincident/duplicate points produce degenerate simplices whose birth and
    # death filtration values are equal (a zero-persistence bar). TopoJS's
    # computePersistentHomology emits these unconditionally (every boundary-
    # matrix reduction pivot is a mathematically valid pair, full stop);
    # Ripser silently drops them from its returned diagram, which is the
    # common convention in TDA tooling (zero-persistence bars carry no
    # information about the Betti-number curve at any filtration value) but
    # is NOT documented as such in Ripser's own API. If the raw counts above
    # disagreed, re-check after excluding these bars from TopoJS's side
    # before concluding there is an algorithm bug -- a raw MISMATCH here is
    # NOT on its own evidence of incorrect computation.
    if not match:
        t_pairs = topojs_result["pairs"]
        EPS = 1e-9
        t_nontrivial_counts: dict[str, int] = {}
        for p in t_pairs:
            if p["death"] == -1:
                continue
            if abs(p["death"] - p["birth"]) < EPS:
                continue  # zero-persistence bar, dropped to match Ripser's convention
            t_nontrivial_counts[str(p["dim"])] = t_nontrivial_counts.get(str(p["dim"]), 0) + 1
        reconciled = True
        for d in range(max_dim + 1):
            t_essential = topojs_result["byDim"][str(d)]["essential"]
            t_nontrivial_finite = t_nontrivial_counts.get(str(d), 0)
            r_finite = ripser_betti[str(d)]["finite"]
            r_essential = ripser_betti[str(d)]["essential"]
            if (t_nontrivial_finite, t_essential) != (r_finite, r_essential):
                reconciled = False
        print(f"Betti-number match after excluding topojs's zero-persistence bars: "
              f"{'YES' if reconciled else 'STILL NO -- investigate further'}")
    if ripser_ms > 0:
        print(f"speed ratio (topojs_ms / ripser_ms): {topojs_result['ms'] / ripser_ms:.1f}x "
              f"({'topojs slower' if topojs_result['ms'] > ripser_ms else 'topojs faster'})")

    csv_path.unlink(missing_ok=True)
    out_path.unlink(missing_ok=True)


def main():
    sunspots = load_sunspots()
    melbourne = load_melbourne()

    # Small case, H0+H1+H2: same order of magnitude as the streaming
    # benchmarks' window sizes. topojs's plain computePersistentHomology
    # needs maxDim=3 (tetrahedra construction) to compute H2 at all -- see
    # the conversion note in run_case().
    run_case("sunspots_n60", sunspots[:60], max_dist=0.15, max_dim=2)
    run_case("melbourne_n60", melbourne[:60], max_dist=0.15, max_dim=2)

    # Larger case, H0+H1 ONLY (max_dim=1 -> topojs maxDim=1, no tetrahedra).
    # An earlier version of this script tried n=400 WITH H2 (max_dim=2) here
    # and topojs's tetrahedra enumeration did not finish in 40s -- Ripser
    # avoids ever materializing tetrahedra explicitly (implicit coboundary +
    # apparent pairs, Bauer 2019), which is exactly the kind of structural
    # advantage this repo's own computePersistentHomologyCohomology partially
    # re-derives (see its docstring) but the PLAIN engine tested here does
    # not have. That is reported honestly as a real scaling limit of this
    # specific engine at H2, not glossed over by quietly capping n lower.
    run_case("sunspots_n400_H0H1only", sunspots[:400], max_dist=0.1, max_dim=1)
    run_case("melbourne_n400_H0H1only", melbourne[:400], max_dist=0.1, max_dim=1)


if __name__ == "__main__":
    main()

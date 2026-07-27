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

RIGOR NOTE (added after an audit found this script ran each case exactly
ONCE -- a single wall-clock sample per case/engine, no repeated trials, no
confidence interval, no significance test, in sharp contrast to
bench/benchmark.ts's streaming-engine comparison, which reports geometric
mean speedup with 95% CIs and a paired t-test across multiple trials per
dataset). This script now repeats each case TRIALS times (default 8,
override with --trials N) and reports the SAME statistical treatment as
bench/benchmark.ts: geometric mean speed ratio, 95% CI (Student's t,
small-sample correct), and a paired t-test on log(speed ratio) across
trials. The first trial of each case still does the full correctness check
(Betti-number match); subsequent trials are timing-only re-runs of the
identical case (same points, same params) -- this measures measurement/
process-spawn noise across repeats of one case, analogous to bench/
benchmark.ts's "repeats" mode caveat for its own fixed small datasets (see
that file's DATASETS registry notes) -- not diversity across independent
data, which would require more real datasets, not more repeats of these four.

Run with: python3 bench/compare_ripser.py [--trials N] [--cases name1,name2]
Requires: pip install --break-system-packages -r bench/requirements.txt
          (or: pip install --break-system-packages ripser numpy)
"""
import json
import math
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    import numpy as np
    from ripser import ripser
except ImportError as exc:
    # BUG FIX (found during a codebase audit): this used to be a bare
    # top-level import with no guard, so anyone following README.md's
    # "Against Ripser" section instructions (`python3 bench/compare_ripser.py`)
    # without having read this file's own docstring first hit a raw
    # ModuleNotFoundError traceback, with the actual install command
    # available only if they went and opened the source.
    sys.exit(
        f"error: missing Python dependency ({exc}).\n"
        f"Install with: pip install --break-system-packages -r "
        f"{Path(__file__).parent / 'requirements.txt'}\n"
        f"(or directly: pip install --break-system-packages ripser numpy)"
    )

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


def t_critical95(df: int) -> float:
    """Two-sided 97.5th-percentile Student's-t critical value. Uses scipy
    (already a transitive dependency here via ripser/persim/scikit-learn)
    instead of reimplementing the Cornish-Fisher expansion bench/benchmark.ts
    uses in JS, since a real stats library is available in this Python
    context and there's no reason to hand-roll it twice."""
    from scipy import stats as scipy_stats
    return float(scipy_stats.t.ppf(0.975, df))


def paired_log_ratio_stats(ratios: list) -> dict:
    """Same statistical treatment as bench/benchmark.ts's pairedStats():
    geometric mean, 95% CI (small-sample Student's t, not a normal-
    approximation z), and a paired t-test on log(ratio), H0: ratio=1."""
    n = len(ratios)
    logs = [math.log(r) for r in ratios]
    mean = sum(logs) / n
    if n < 2:
        return {"ci_high": math.exp(mean), "ci_low": math.exp(mean),
                "geo_mean": math.exp(mean), "n": n, "t_stat": float("nan")}
    variance = sum((v - mean) ** 2 for v in logs) / (n - 1)
    se = math.sqrt(variance) / math.sqrt(n)
    t_crit = t_critical95(n - 1)
    t_stat = mean / se if se > 0 else float("inf")
    return {
        "ci_high": math.exp(mean + t_crit * se),
        "ci_low": math.exp(mean - t_crit * se),
        "geo_mean": math.exp(mean),
        "n": n,
        "t_stat": t_stat,
    }


def time_only_rerun(name: str, engine: str, points: np.ndarray, max_dist: float,
                     max_dim: int) -> float:
    """Timing-only re-run of an already-correctness-verified case (no Betti
    comparison, no console spam) -- used for repeat trials 2..TRIALS so the
    statistical treatment below has more than one sample per case/engine."""
    csv_path = TMPDIR / f"{name}_{engine}_rerun.csv"
    out_path = TMPDIR / f"{name}_{engine}_rerun_result.json"
    np.savetxt(csv_path, points, fmt="%.10f")
    topojs_max_dim = max_dim + 1 if max_dim >= 2 else max_dim
    subprocess.run(
        [
            "node", "--experimental-strip-types",
            str(HERE / "export_topojs_diagram.ts"),
            str(csv_path), "2", str(max_dist), str(topojs_max_dim), str(out_path), engine,
        ],
        check=True, capture_output=True, text=True,
    )
    ms = json.loads(out_path.read_text())["ms"]
    csv_path.unlink(missing_ok=True)
    out_path.unlink(missing_ok=True)
    return ms


def betti_summary(dgms, maxdim: int) -> dict:
    out = {}
    for d in range(maxdim + 1):
        dgm = dgms[d]
        finite = int(np.sum(np.isfinite(dgm[:, 1])))
        essential = int(np.sum(~np.isfinite(dgm[:, 1])))
        out[str(d)] = {"finite": finite, "essential": essential}
    return out


def run_topojs_engine(name: str, engine: str, points: np.ndarray, max_dist: float,
                       max_dim: int, ripser_ms: float, ripser_betti: dict) -> dict:
    """Run one topojs engine ("plain" or "cohom") against the same case Ripser
    already ran, compare Betti numbers, and return a small results dict for
    the cross-engine summary table. Split out of run_case() so both engines
    can be run and compared side by side against the same Ripser result,
    instead of re-running Ripser (nondeterministic timing) per engine."""
    csv_path = TMPDIR / f"{name}_{engine}.csv"
    out_path = TMPDIR / f"{name}_{engine}_result.json"
    np.savetxt(csv_path, points, fmt="%.10f")
    # NOTE on convention mismatch: ripser's `maxdim` is the highest HOMOLOGY
    # dimension to compute (2 = H0+H1+H2). topojs's engines' `maxDim` is the
    # highest SIMPLEX dimension to construct -- per their docstrings, maxDim=1
    # and maxDim=2 both mean "H0+H1 only"; you must pass maxDim=3 (tetrahedra)
    # to get H2 at all. This tripped up the first run of this script (saw a
    # real-looking "topojs missed an H2 class" mismatch that was actually
    # just this off-by-one in API convention, not an algorithm bug) --
    # documented here so it isn't silently "fixed" by coincidence again.
    topojs_max_dim = max_dim + 1 if max_dim >= 2 else max_dim
    subprocess.run(
        [
            "node", "--experimental-strip-types",
            str(HERE / "export_topojs_diagram.ts"),
            str(csv_path), "2", str(max_dist), str(topojs_max_dim), str(out_path), engine,
        ],
        check=True, capture_output=True, text=True,
    )
    topojs_result = json.loads(out_path.read_text())
    if engine == "plain":
        label = "topojs[plain] (pure JS, computePersistentHomology)"
    elif engine == "cohom":
        label = "topojs[cohom] (pure JS, computePersistentHomologyCohomology -- re-derives some Ripser structural tricks)"
    else:
        label = "topojs[impl] (pure JS, computePersistentHomologyImplicit -- implicit coboundary, no materialized simplices)"
    print(f"{label}: {topojs_result['ms']:.2f}ms  byDim={topojs_result['byDim']}")

    # -- compare --
    match = True
    for d in range(max_dim + 1):
        t_finite = topojs_result["byDim"][str(d)]["finite"]
        t_essential = topojs_result["byDim"][str(d)]["essential"]
        r_finite = ripser_betti[str(d)]["finite"]
        r_essential = ripser_betti[str(d)]["essential"]
        if (t_finite, t_essential) != (r_finite, r_essential):
            match = False
            print(f"  [{engine}] MISMATCH at dim {d}: topojs finite={t_finite} essential={t_essential}  "
                  f"ripser finite={r_finite} essential={r_essential}")
    print(f"[{engine}] Betti-number match across all dims: {'YES' if match else 'NO'}")

    # -- reconcile via zero-persistence-bar convention, if raw counts mismatched --
    # Root-caused (see README.md's "Against Ripser" section -- the fuller
    # writeup used to live in a separate docs/COMPARISON.md, since removed
    # in favor of a single README):
    # coincident/duplicate points produce degenerate simplices whose birth and
    # death filtration values are equal (a zero-persistence bar). TopoJS's
    # engines emit these unconditionally (every boundary-matrix reduction
    # pivot is a mathematically valid pair, full stop); Ripser silently drops
    # them from its returned diagram, which is the common convention in TDA
    # tooling (zero-persistence bars carry no information about the
    # Betti-number curve at any filtration value) but is NOT documented as
    # such in Ripser's own API. If the raw counts above disagreed, re-check
    # after excluding these bars from TopoJS's side before concluding there
    # is an algorithm bug -- a raw MISMATCH here is NOT on its own evidence
    # of incorrect computation.
    reconciled = None
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
        print(f"[{engine}] Betti-number match after excluding topojs's zero-persistence bars: "
              f"{'YES' if reconciled else 'STILL NO -- investigate further'}")

    speed_ratio = topojs_result["ms"] / ripser_ms if ripser_ms > 0 else float("inf")
    if ripser_ms > 0:
        print(f"[{engine}] speed ratio (topojs_ms / ripser_ms): {speed_ratio:.1f}x "
              f"({'topojs slower' if topojs_result['ms'] > ripser_ms else 'topojs faster'})")

    csv_path.unlink(missing_ok=True)
    out_path.unlink(missing_ok=True)
    return {
        "engine": engine, "ms": topojs_result["ms"], "match": match,
        "reconciled": reconciled, "speed_ratio": speed_ratio,
    }


def run_case(name: str, points: np.ndarray, max_dist: float, max_dim: int,
             trials: int = 8) -> list:
    n = len(points)
    print(f"\n=== {name}: n={n} points, maxDist={max_dist}, maxDim={max_dim}, trials={trials} ===")

    # -- Ripser (run once per case, shared as the baseline for both topojs engines) --
    t0 = time.perf_counter()
    result = ripser(points, maxdim=max_dim, thresh=max_dist)
    ripser_ms = (time.perf_counter() - t0) * 1000
    ripser_betti = betti_summary(result["dgms"], max_dim)
    print(f"ripser (C++, state-of-the-art batch reference), trial 0: {ripser_ms:.2f}ms  byDim={ripser_betti}")

    engine_results = []
    for engine in ("plain", "cohom", "impl"):
        r = run_topojs_engine(name, engine, points, max_dist, max_dim, ripser_ms, ripser_betti)
        r["case"] = name
        engine_results.append(r)

    def _ms(e: str) -> float:
        return next(r["ms"] for r in engine_results if r["engine"] == e)

    plain_ms, cohom_ms, impl_ms = _ms("plain"), _ms("cohom"), _ms("impl")
    if cohom_ms > 0:
        print(f"cohom vs plain (same case): {plain_ms / cohom_ms:.2f}x "
              f"({'cohom faster' if cohom_ms < plain_ms else 'cohom slower or equal'})")
    if impl_ms > 0:
        print(f"impl vs plain (same case): {plain_ms / impl_ms:.2f}x "
              f"({'impl faster' if impl_ms < plain_ms else 'impl slower or equal'})")

    # -- repeat trials 2..N: timing-only --
    ratios: dict[str, list[float]] = {}
    for e in ("plain", "cohom", "impl"):
        e_ms = _ms(e)
        ratios[e] = [e_ms / ripser_ms] if ripser_ms > 0 else []
    for _ in range(trials - 1):
        t0 = time.perf_counter()
        ripser(points, maxdim=max_dim, thresh=max_dist)
        r_ms = (time.perf_counter() - t0) * 1000
        if r_ms > 0:
            for e in ("plain", "cohom", "impl"):
                ratios[e].append(time_only_rerun(name, e, points, max_dist, max_dim) / r_ms)

    stats = {}
    for e in ("plain", "cohom", "impl"):
        stats[e] = paired_log_ratio_stats(ratios[e])
        s = stats[e]
        print(f"[{e}] geometric mean speed ratio across {s['n']} trials: "
              f"{s['geo_mean']:.2f}x  (95% CI: {s['ci_low']:.2f}x .. {s['ci_high']:.2f}x)  "
              f"t={s['t_stat']:.2f}")

    for r in engine_results:
        r["ratio_stats"] = stats[r["engine"]]

    return engine_results


def main():
    trials = 8
    case_filter = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--trials" and i + 1 < len(args):
            trials = int(args[i + 1])
            i += 2
        elif args[i] == "--cases" and i + 1 < len(args):
            case_filter = set(args[i + 1].split(","))
            i += 2
        else:
            i += 1

    sunspots = load_sunspots()
    melbourne = load_melbourne()

    all_results = []

    def maybe_run(name, points, max_dist, max_dim):
        if case_filter is not None and name not in case_filter:
            return []
        return run_case(name, points, max_dist, max_dim, trials=trials)

    # Small case, H0+H1+H2: same order of magnitude as the streaming
    # benchmarks' window sizes. topojs's plain computePersistentHomology
    # needs maxDim=3 (tetrahedra construction) to compute H2 at all -- see
    # the conversion note in run_topojs_engine().
    all_results += maybe_run("sunspots_n60", sunspots[:60], 0.15, 2)
    all_results += maybe_run("melbourne_n60", melbourne[:60], 0.15, 2)

    # Larger case, H0+H1 ONLY (max_dim=1 -> topojs maxDim=1, no tetrahedra).
    # An earlier version of this script tried n=400 WITH H2 (max_dim=2) here
    # and topojs's PLAIN engine's tetrahedra enumeration did not finish in
    # 40s -- Ripser avoids ever materializing tetrahedra explicitly (implicit
    # coboundary + apparent pairs, Bauer 2019), which is exactly the kind of
    # structural advantage this repo's own computePersistentHomologyCohomology
    # partially re-derives (see its docstring). Both engines are compared at
    # H0+H1 here for a fair apples-to-apples read on the same case.
    #
    # RESOLVED (was previously "not-yet-answered" here): whether the cohom
    # engine also survives the H2/n=400 case the plain engine couldn't was
    # answered by a separate measurement -- yes, it finishes, at 142x and
    # 41x slower than Ripser on two datasets with correct Betti numbers on
    # both. See README.md's "Against Ripser" section. This script itself
    # was never extended to add that H2/n=400 cohom case directly; it's
    # still H0+H1-only below for that reason, not because the question is
    # open.
    all_results += maybe_run("sunspots_n400_H0H1only", sunspots[:400], 0.1, 1)
    all_results += maybe_run("melbourne_n400_H0H1only", melbourne[:400], 0.1, 1)

    # -- cross-case summary: three engines vs Ripser --
    print("\n=== summary: topojs engine speed ratio vs Ripser, across all cases ===")
    print(f"{'case':<28}{'plain (x, 95% CI)':<26}{'cohom (x, 95% CI)':<26}{'impl (x, 95% CI)':<26}")
    geo_means: dict[str, list[float]] = {"plain": [], "cohom": [], "impl": []}
    for case_name in dict.fromkeys(r["case"] for r in all_results):
        case_rs = [r for r in all_results if r["case"] == case_name]
        cells = []
        for e in ("plain", "cohom", "impl"):
            eng_r = next(r for r in case_rs if r["engine"] == e)
            s = eng_r["ratio_stats"]
            geo_means[e].append(s["geo_mean"])
            cells.append(f"{s['geo_mean']:.1f}x ({s['ci_low']:.1f}-{s['ci_high']:.1f})")
        print(f"{case_name:<28}{cells[0]:<26}{cells[1]:<26}{cells[2]:<26}")
    if any(geo_means[e] for e in geo_means):
        import statistics
        parts = [f"{e}={statistics.geometric_mean(geo_means[e]):.1f}x" if geo_means[e] else f"{e}=N/A" for e in ("plain", "cohom", "impl")]
        print(f"\ngeometric mean slowdown vs Ripser (across cases' multi-trial geo means): {', '.join(parts)}")
    all_reconciled = all(r["match"] or r["reconciled"] for r in all_results)
    print(f"all cases correct (raw match OR reconciled via zero-persistence-bar convention): "
          f"{'YES' if all_reconciled else 'NO -- see MISMATCH lines above'}")


if __name__ == "__main__":
    main()

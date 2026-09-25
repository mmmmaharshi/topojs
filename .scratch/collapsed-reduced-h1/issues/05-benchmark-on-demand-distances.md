# 05: Benchmark on-demand distances

**What to build:** Measure the on-demand reduced-engine path against the existing matrix-based implementation on approved real data and record whether the change is worth keeping.

**Blocked by:** 04: Remove eager distance-matrix allocation.

**Status:** ready-for-agent

- [x] The benchmark records before-and-after timing, structural memory indicators, edge counts, triangle counts, and barcode agreement.
- [x] Finite sparse and dense cases are both represented.
- [x] Unbounded and enclosing-radius behavior remain covered.
- [x] No synthetic data is added.
- [x] Full tests, typecheck, build, lint, demo build, and diff checks pass.

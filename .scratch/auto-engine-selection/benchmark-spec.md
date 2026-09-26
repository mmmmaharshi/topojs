# Unified auto-engine benchmark matrix

## Problem Statement

The existing reduced benchmark compares reduced H1 with a direct standard H1 call. It does not measure the public `auto` decision, and it does not compare all current candidates on identical requests. A future `auto` policy cannot use the existing reduced speedups as thresholds.

## Solution

Add a benchmark-only public-API matrix. For each approved real dataset and cutoff, call the unified API with `maxDim: 1` and compare these candidates:

- `auto`
- `cohomology`
- `implicit-full`
- `reduced`
- `reduced` with `collapse: true`

Use the same points, cutoff, and public option shape for every candidate. Record preflight signals where the current implementation permits them, including vertex count, dimensions, cutoff, edge count, average degree, and implicit triangle count. Mark signals unavailable when the current `CombinatorialIndex` limit prevents the probe. Compare every successful candidate against the public `cohomology` result using canonical H0+H1 pairs.

This benchmark does not change `auto` selection. It produces evidence for a later policy decision.

## User Stories

1. As a maintainer, I want every candidate to use the same public request, so that auto-policy measurements are comparable.
2. As a maintainer, I want auto included in the matrix, so that the current dispatch decision has a measured baseline.
3. As a maintainer, I want cohomology and implicit-full included, so that reduced timing has a fair H1 reference.
4. As a maintainer, I want reduced and collapsed reduced included, so that the new paths are compared with the existing engines.
5. As a maintainer, I want preflight edge and triangle signals recorded, so that later policy work has feature signals.
6. As a maintainer, I want unsupported candidates recorded as unavailable, so that implementation limits are visible.
7. As a maintainer, I want barcode agreement checked for every successful candidate, so that a faster result cannot hide a correctness change.
8. As a maintainer, I want real datasets only, so that benchmark claims follow repository policy.
9. As a maintainer, I want a CLI filter, so that one dataset can be rerun during development.
10. As a maintainer, I want a recorded results file, so that the matrix is reproducible outside a terminal session.
11. As a maintainer, I want timings and simplex counts, so that policy work can distinguish work from latency.
12. As a maintainer, I want no production behavior change, so that this remains measurement-only work.

## Implementation Decisions

- Extend the existing reduced real-data benchmark instead of duplicating its data loaders.
- Add a `--public-matrix` mode and a discoverable npm script.
- Use the public unified `computePersistentHomology` API for every candidate.
- Use public `maxDim: 1`; do not use the direct internal standard baseline.
- Use cohomology as the agreement reference because it supports the H0+H1 scope on all eligible inputs.
- Record the `auto` candidate's result separately, even when it resolves to another engine.
- Record `implicit-full` and `auto` as unavailable when their current preflight rejects the input size.
- Compute preflight signals with the current implicit builder only when it can run. Do not add a new production preflight API.
- Record `epsilon` and whether the cutoff is finite in the output metadata.
- Keep collapse explicit; the matrix must not imply automatic collapse selection.
- Do not change `HomologyOptions`, engine selection, or the reduced production path.
- Store a text result under `bench/data/` using the existing benchmark convention.

## Testing Decisions

- Run a filtered smoke matrix on one small real dataset before the full matrix.
- Run the full matrix on all existing reduced benchmark cases, including the lag-embedded sunspots cases.
- Verify that every successful candidate agrees with cohomology on canonical H0/H1 pairs.
- Verify that unavailable candidates produce a clear message and do not fail the matrix.
- Verify that the output contains preflight signals, candidate timings, and simplex counts.
- Run typecheck, build, full lint, targeted tests, and diff checks.
- Do not add synthetic data or a production performance threshold.

## Out of Scope

- Changing `auto` behavior.
- Adding a reduced preparation probe to production code.
- Automatically selecting `collapse`.
- Changing the implicit 8K/60K thresholds.
- Adding new public engine names or options.
- Claiming a universal reduced crossover from this matrix.

## Further Notes

The matrix is a policy input, not a policy. A later implementation should use its measurements to decide whether a finite-cutoff H1 candidate gate is worthwhile. The benchmark must preserve the current `auto` result until that decision is made.

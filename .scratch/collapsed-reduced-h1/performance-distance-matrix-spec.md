# Reduced-engine distance-matrix performance spec

## Problem Statement

The reduced Vietoris–Rips engine currently builds a complete squared-distance matrix before it enumerates edges. For a finite `maxDist`, the spatial grid already supplies a candidate superset, but the engine still pays the full `O(n²·dims)` distance construction and `O(n²)` memory cost. This wastes time and memory when the filtered graph is sparse or when a large point cloud has a small cutoff.

The optimization must preserve the exact H0 and H1 result, the fixed `(value, u, v)` edge order, threshold-boundary behavior, and the existing collapsed and uncollapsed reduced paths.

## Solution

Replace the reduced engine's materialized squared-distance matrix with on-demand squared-distance calculation. The existing spatial grid still produces the same candidate pairs. Each candidate pair receives the same squared-distance calculation and the same threshold comparison as before. The engine then keeps the existing edge, collapse, lune, representative, and reduction logic unchanged.

The optimization applies to the reduced engine only. Other engines keep their current distance representation unless a separate benchmark proves that they need the same change.

## User Stories

1. As a TopoJS caller with a finite cutoff, I want the reduced engine to avoid a full distance matrix, so that large sparse inputs use less memory.
2. As a TopoJS caller with a finite cutoff, I want the same H0 and H1 pairs, so that the optimization does not change results.
3. As a TopoJS caller with equal-distance edges, I want the same deterministic edge order, so that tie-heavy inputs remain reproducible.
4. As a TopoJS caller using `collapse: true`, I want the same collapsed result and counts, so that the optimization composes with the new path.
5. As a TopoJS caller using an unbounded cutoff, I want the existing enclosing-radius behavior, so that the optimization does not change filtration scope.
6. As a TopoJS caller with a dense input, I want a measured decision about time and memory, so that the optimization does not make dense cases slower without evidence.
7. As a maintainer, I want the spatial-grid candidate path tested separately from brute force, so that a future grid change cannot silently alter edge selection.
8. As a maintainer, I want the same squared-distance summation order, so that threshold-boundary behavior remains exact.
9. As a maintainer, I want no new public API for the optimization, so that the default and opt-in interfaces stay stable.
10. As a maintainer, I want real-data before-and-after measurements, so that performance claims use approved external data.
11. As a maintainer, I want failures to identify the edge or distance stage, so that a regression is actionable.
12. As a maintainer, I want the full existing differential corpus to run after the change, so that the optimization is not accepted on a small example alone.

## Implementation Decisions

- Keep `computePersistentHomology` and the reduced-engine `collapse` option unchanged.
- Remove the reduced engine's eager `SquaredDistanceMatrix` allocation.
- Use the existing `squaredEuclideanDistance` primitive for candidate rechecks and brute-force pair enumeration.
- Keep the existing spatial-grid threshold and candidate ordering.
- Keep the existing squared threshold comparison and the same coordinate summation order.
- Keep the existing `(value, u, v)` edge sort and the final collapsed-edge sort.
- Keep all current collapse cost gates and reduced-engine H0/H1 scope.
- Do not add an automatic collapse policy or change the meaning of `collapse: false` and `collapse: true`.
- Do not add a distance cache unless profiling shows that repeated calculations dominate after the matrix removal.
- Keep the real-data benchmark as the performance measurement seam. Add a before-and-after record with time, peak or retained structural memory indicators, and barcode agreement.
- Treat the existing heap-delta measurements as noisy. Do not claim a memory speedup unless a more reliable measurement supports it.

## Testing Decisions

- Run the existing reduced differential suite against the independent standard and brute-force references.
- Cover finite cutoffs below, at, and above representative edge distances.
- Cover tie-heavy grids and one-dimensional lattices to detect ordering changes.
- Cover finite inputs below and above the spatial-grid crossover.
- Cover unbounded inputs and the enclosing-radius cap.
- Run both `collapse: false` and `collapse: true` on the same corpus.
- Run the real-data reduced benchmark before and after the change, including all existing approved datasets and cutoffs.
- Compare canonical H0/H1 pairs, edge counts, triangle counts, and timing.
- Run the full repository tests, typecheck, build, lint, demo build, and diff check before completion.

## Out of Scope

- Changing the standard, cohomology, implicit, or fast engines.
- Adding a new public distance-matrix or performance option.
- Adding an automatic density threshold for collapse.
- Adding approximate distances or changing the exact threshold predicate.
- Refactoring the shared Rips builders before measurements prove a need.
- Adding H2 support to the reduced engine.
- Adding synthetic benchmark data or publishing unsupported memory claims.

## Further Notes

The expected primary gain is lower retained memory for finite sparse inputs. The expected time gain is positive only when the grid omits many pairs. Dense or unbounded cases may remain time-neutral because every pair still needs one squared-distance calculation. The benchmark result decides whether the change is kept.

# Collapsed reduced-H1 implementation spec

## Problem Statement

TopoJS has two exact pieces that do not currently compose. `collapseDominatedEdges` returns a smaller sorted weighted edge list, while the reduced Vietoris–Rips engine rebuilds distances from the original points. A caller cannot select a collapsed weighted skeleton for reduced H1 without rebuilding the full metric skeleton.

The implementation must preserve the default reduced-engine result. The opt-in path must return the same complete H0 and H1 persistence pairs for inputs accepted by the documented collapse contract, while reporting the collapsed edge and triangle counts.

## Solution

Add an optional `collapse` field to the existing `HomologyOptions` interface. The field defaults to `false` and has an effect only when `engine` is `"reduced"`. In the opt-in path, the reduced engine passes its sorted temporary edges to `collapseDominatedEdges` with `{ maxDim: 2 }`, then builds the edge index, adjacency, lune components, and triangle birth values from the returned edges. It must not reuse original-distance values for shifted edges.

The path uses one fixed `(value, u, v)` order and one global deterministic lune representative function. It does not change the standard, cohomology, implicit, fast, or image engines. It does not make reduced H2 available.

## User Stories

1. As a library caller, I want to opt into collapsed reduced H1, so that I can reduce edge and triangle work on dense inputs.
2. As a library caller, I want the default reduced engine to remain unchanged, so that existing calls keep their current behavior.
3. As a library caller, I want the option to use the existing unified API, so that I do not learn a second entry point.
4. As a library caller, I want the option ignored for other engines, so that adding it cannot change standard or cohomology behavior.
5. As a library caller, I want complete H0 and H1 pairs, so that collapse does not silently remove essential classes.
6. As a library caller, I want collapsed edge and triangle counts, so that I can measure the reduction directly.
7. As a library caller, I want shifted edges to use their returned filtration values, so that persistence births match the collapsed filtration.
8. As a library caller, I want deterministic tie handling, so that repeated calls return the same result.
9. As a maintainer, I want differential tests against an independent standard or brute-force reference, so that the new path is not self-validated.
10. As a maintainer, I want real-data benchmark coverage, so that performance claims use repository-approved data.
11. As a maintainer, I want the public option documented, so that callers understand scope and limits.
12. As a maintainer, I want the default engine to remain the default until tests and benchmarks pass, so that a performance optimization does not change the release contract silently.

## Implementation Decisions

- Add `collapse?: boolean` to the existing `HomologyOptions` interface with a default of `false`.
- Do not add a new public function. The existing unified `computePersistentHomology` options object is the smallest public seam.
- Apply the option only in the `"reduced"` branch. Other engines ignore it for backward compatibility.
- Keep the existing positional overloads unchanged.
- Build the temporary edge list and sort it before calling `collapseDominatedEdges`.
- Call the collapse helper with `maxDim: 2`, because reduced H1 needs triangles even when the public scope is H1 only.
- Use the returned edge list for edge order, adjacency, lune membership, triangle birth values, and H1 boundary pivots.
- Keep one fixed `(value, u, v)` total order and one global deterministic representative function. Do not reselect representatives per filtration value.
- Preserve the existing collapse cost gates and algorithm. Do not add or remove edges outside that helper.
- Keep the reduced engine H0 and H1 only. The option does not enable H2.
- Preserve the current default path and result counts when `collapse` is absent or false.
- Update the collapse module documentation to describe the completed-real H1-module composition and its limits.
- Update the public API documentation and benchmark notes for the option and its scope.
- Do not change the production collapse implementation, standard engines, streaming engines, or demo behavior beyond the new option.

## Testing Decisions

- Extend the reduced-engine differential suite to run each existing corpus case in both default and opt-in modes.
- Compare opt-in pairs with the existing independent reference or the uncollapsed standard engine, using the current canonical pair comparison.
- Keep the existing independent reference for small cases and the independent standard path for larger cases.
- Add a dense sanity assertion that a qualifying input reports fewer collapsed edges or triangles, while allowing existing cost gates to return an unchanged graph.
- Add a public-barrel runtime assertion for `{ engine: "reduced", collapse: true }`.
- Add a typecheck or declaration assertion for the new public option.
- Keep the default-mode assertions to prove that `collapse: false` and an omitted option preserve the current behavior.
- Run the existing edge-collapse and index tests after each implementation slice.
- Extend the reduced real-data benchmark with an opt-in mode. Do not add synthetic benchmark data.
- Run the full suite, typecheck, build, lint, demo build when public re-exports change, and `git diff --check` before completion.

## Out of Scope

- Making the collapsed path the default.
- Adding H2 support to the reduced engine.
- Changing the collapse domination rule or its cost gates.
- Claiming a canonical reduced complex, simplicial chain map, barcode map, or map between different collapse outputs.
- Proving the citation-chain theorem in production code.
- Adding a new public top-level function.
- Adding synthetic benchmark datasets or performance claims.
- Refactoring the shared Rips builders solely to support this option.

## Further Notes

The research result applies to completed real values and a fixed labeled final weighted graph. The implementation must not imply stronger canonicality. The option is an exact H1 optimization, not a change to the persistence theorem or a claim of new general mathematics.

# 04: Remove eager distance-matrix allocation

**What to build:** Make the reduced engine calculate squared distances on demand while preserving the exact edge set, ordering, and H0/H1 result.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Finite and unbounded reduced paths use the shared on-demand squared-distance primitive.
- [x] Spatial-grid candidate rechecks preserve the same threshold predicate and summation order.
- [x] The existing differential corpus passes for both collapse modes.
- [x] Tie-heavy and grid-crossover cases pass.
- [x] The reduced engine no longer allocates a full squared-distance matrix.

# 01: Add the opt-in collapsed reduced-H1 path

**What to build:** Let callers select collapsed reduced H1 through the existing homology options. The new path must use the returned weighted edges for all reduced-complex construction and triangle filtration values. The default path must remain unchanged.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] `collapse` is optional, defaults to false, and affects only the reduced engine.
- [x] The reduced path calls the existing collapse helper with a triangle-capable dimension.
- [x] Edge order, adjacency, lune components, triangle values, and H1 pivots use the returned edge list.
- [x] A focused differential test covers shifted, trimmed, and unchanged edge cases.
- [x] The option does not change the positional API or other engines.

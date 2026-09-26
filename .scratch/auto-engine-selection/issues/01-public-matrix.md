# 01: Add the public auto-engine benchmark matrix

**What to build:** Add a benchmark-only mode that calls the public unified API for `auto`, `cohomology`, `implicit-full`, `reduced`, and `reduced + collapse` on the same real inputs and cutoffs. Record preflight signals, timings, simplex counts, and barcode agreement without changing `auto` selection.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] Public matrix mode compares all five candidates through `computePersistentHomology` with `maxDim: 1`.
- [x] Cohomology is the agreement reference and unsupported candidates are recorded clearly.
- [x] Preflight records `E`, average degree, and `T_g` when the current implicit probe permits it.
- [x] Real-data-only matrix results are written under `bench/data/`.
- [x] A filtered smoke run and the full matrix complete without changing production engine selection.

# 03: Measure the collapsed path on real data

**What to build:** Add an opt-in measurement to the existing reduced real-data benchmark and record whether the collapsed path reduces work and preserves the reported H1 result. Do not activate the option by default.

**Blocked by:** 02: Validate and document the public option.

**Status:** ready-for-agent

- [x] The benchmark compares default and collapsed reduced H1 on approved real datasets.
- [x] Results report runtime, memory signals, edge counts, triangle counts, and pair agreement.
- [x] The benchmark uses the existing data registry and does not add synthetic data.
- [x] The release note states that default activation requires a separate decision after measurement.
- [x] Full tests, typecheck, build, lint, demo build, and diff checks pass.

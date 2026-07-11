# CLAUDE.md

Guidance for AI agents (and human contributors) working in this repository.

## What this is

TopoJS is a zero-dependency, pure-TypeScript library for computing
persistent homology of Vietoris–Rips complexes (H0/H1/H2) and cubical
complexes (2D grayscale images). No WASM, WebGL, WebGPU, or server. See
`README.md` for the full feature/API overview.

## Commands

- Build: `npm run build` (runs `tsc`, output in `dist/`, gitignored)
- Typecheck only: `npx tsc --noEmit`
- Test: `npm test` (`vitest run`) — `npm run test:watch` for watch mode,
  `npm run test:coverage` for a coverage report
- Lint: `npm run lint` (`eslint .`)
- Demo bundle: `npm run build:demo` (esbuild, bundles `demo/bundle-entry.ts` to
  `demo/topojs-bundle.mjs`) — re-run this after any change to a function
  re-exported from `demo/bundle-entry.ts`, otherwise the demo page silently
  drifts from `src/` (this happened once; see git history for finding #3)
- Benchmarks (real data only, not part of the published package):
  `npm run bench` or `npm run bench -- <dataset>` (see `bench/benchmark.ts`
  for the dataset registry and flags: `--scaling`, `--regime`, `--memory`)
- Ripser cross-check (separate Python script, own dependencies — see
  `bench/requirements.txt`): `python3 bench/compare_ripser.py`

CI (`.github/workflows/ci.yml`) runs `npm test`, `npx tsc --noEmit`, and
`npm run lint` on Node 20/22/24. Note: `bench`/`demo:real-data` require
Node ≥22.7 (`--experimental-transform-types`) and are NOT run in CI.

## Public API boundary

Only what is re-exported from `src/index.ts` is the public contract
(`package.json`'s `main`/`types`/`exports` all point at its compiled
output). Everything under `src/core/`, `src/export/`, `src/streaming/`,
and `src/data/` is implementation detail and may be reorganized without a
semver-major bump, UNLESS it's re-exported from `src/index.ts`. When
adding a new public function or class, export it from `src/index.ts` and
add a row to `README.md`'s API table — both are checked directly by
`test/index.test.ts` (a barrel smoke test) and by the audit that added
this file finding the API table under-documented the actual surface.

## Conventions to match

- **TypeScript strict mode** (`strict: true`, `noUncheckedIndexedAccess: true`
  in `tsconfig.json`). Non-null assertions (`!`) are used deliberately and
  heavily in the hot paths (`src/core/*`) — each one is paired with a
  reasoned invariant, usually documented in a nearby comment, not a lazy
  type-check bypass. Match that standard for new assertions: don't add one
  without being able to state why it's safe.
- **Differential testing, not just unit tests.** Every homology engine
  (`computePersistentHomologyFast`, `computePersistentHomologyCohomology`,
  `IncrementalH1`, the spatial grid, etc.) is validated against an
  independent reference — usually `computePersistentHomology` itself, or a
  hand-written brute-force implementation inline in the test file — across
  many random seeds/configs, not just hand-picked examples. New engines or
  optimizations should follow this pattern: write the brute-force/reference
  version first, cross-validate at scale (hundreds to thousands of random
  trials), and only then trust the optimized version. This project's own
  history has caught real bugs (and rejected a plausible-looking but wrong
  algorithm) exactly this way — see `src/core/bottleneck.ts`'s module
  docstring for a worked example.
- **Real-data-only benchmarks.** Synthetic/i.i.d. random benchmark data was
  deliberately removed repo-wide in favor of real, externally-sourced
  datasets (`bench/data/`, `src/data/realworld-datasets.ts`). Don't add new
  synthetic-data performance claims; add a new dataset to `bench/benchmark.ts`'s
  registry instead.
- **Shared primitives over inline copies.** `computeH0Phase` (`src/core/h0.ts`),
  `UnionFind` (`src/core/unionfind.ts`), and `DenseWorkingCol`
  (`src/core/reduction.ts`) are used by every engine that needs them. An
  earlier audit found the H0 phase and union-find logic copy-pasted inline
  across five files with no compiler or test enforcing they stayed in sync
  — before adding a new engine, check whether an existing shared primitive
  already does what you need.
- **No premature allocation in hot, high-frequency paths.** `IncrementalH1`
  (the streaming engine) pools per-triangle/per-push retained and
  transient state into flat typed arrays / reused instances rather than
  allocating one small object per item per call — see its class docstring
  for the measured memory-blowup history this pattern fixed.

## Where to look first

- `src/index.ts` — the full public API surface, one file, with docstrings
  explaining what's validated and how.
- `README.md`'s "Comparison Against Prior Work" section — the honest,
  measured (not claimed) performance and correctness story, including
  known limitations.
- `test/helpers.ts` — shared test utilities (seeded RNG, ground-truth
  topology generators) used across the suite.

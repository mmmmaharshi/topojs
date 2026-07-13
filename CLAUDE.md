# CLAUDE.md

Guidance for AI agents (and human contributors) working in this repository.

## What this is

TopoJS is a zero-dependency, pure-TypeScript library for computing persistent homology of Vietoris–Rips complexes (H0/H1/H2) and cubical complexes (2D grayscale images). No WASM, WebGL, WebGPU, or server. See `README.md` for the full feature/API overview.

## Commands

- Build: `npm run build` (runs `tsc`, output in `dist/`, gitignored)
- Typecheck only: `npx tsc --noEmit`
- Test: `npm test` (`vitest run`) — `npm run test:watch` for watch mode, `npm run test:coverage` for a coverage report
- Lint: `npm run lint` (`ultracite check`, wraps oxlint)
- Demo bundle: `npm run build:demo` (esbuild, bundles `demo/bundle-entry.ts` to `demo/topojs-bundle.mjs`) — re-run this after any change to a function re-exported from `demo/bundle-entry.ts`, otherwise the demo page silently drifts from `src/` (this happened once; see git history for finding #3)
- Benchmarks (real data only, not part of the published package): `npm run bench` or `npm run bench -- <dataset>` (see `bench/benchmark.ts` for the dataset registry and flags: `--scaling`, `--regime`, `--memory`). `npm run bench:all` runs every axis (default, `--scaling`, `--memory`, `--regime`) across every registered dataset in one command — takes a few minutes; requires a POSIX shell (macOS/Linux/WSL/git-bash), not plain Windows `cmd.exe`, since it uses a `for` loop.
- Ripser cross-check (separate Python script, own dependencies — see `bench/requirements.txt`): `python3 bench/compare_ripser.py`

CI (`.github/workflows/ci.yml`) runs `npm test`, `npx tsc --noEmit`, and `npm run lint` on Node 22/24. Note: `bench`/`demo:real-data` require Node ≥22.7 (`--experimental-strip-types` -- plain type stripping, not the now-removed `--experimental-transform-types`; this codebase uses no enums/namespaces, so plain stripping has always been sufficient) and are NOT run in CI.

## Public API boundary

Only what is re-exported from `src/index.ts` is the public contract (`package.json`'s `main`/`types`/`exports` all point at its compiled output). Everything under `src/core/`, `src/export/`, `src/streaming/`, and `src/data/` is implementation detail and may be reorganized without a semver-major bump, UNLESS it's re-exported from `src/index.ts`. When adding a new public function or class, export it from `src/index.ts` and add a row to `README.md`'s API table — both are checked directly by `test/index.test.ts` (a barrel smoke test) and by the audit that added this file finding the API table under-documented the actual surface.

## Conventions to match

- **TypeScript strict mode** (`strict: true`, `noUncheckedIndexedAccess: true` in `tsconfig.json`). Non-null assertions (`!`) are used deliberately and heavily in the hot paths (`src/core/*`) — each one is paired with a reasoned invariant, usually documented in a nearby comment, not a lazy type-check bypass. Match that standard for new assertions: don't add one without being able to state why it's safe.
- **Differential testing, not just unit tests.** Every homology engine (`computePersistentHomology`, `IncrementalH1`, the spatial grid, etc.) is validated against an independent reference — usually `computePersistentHomology` itself, or a hand-written brute-force implementation inline in the test file — across many random seeds/configs, not just hand-picked examples. New engines or optimizations should follow this pattern: write the brute-force/reference version first, cross-validate at scale (hundreds to thousands of random trials), and only then trust the optimized version. This project's own history has caught real bugs (and rejected a plausible-looking but wrong algorithm) exactly this way — see `src/core/bottleneck.ts`'s module docstring for a worked example.
- **Real-data-only benchmarks.** Synthetic/i.i.d. random benchmark data was deliberately removed repo-wide in favor of real, externally-sourced datasets (`bench/data/`, `src/data/realworld-datasets.ts`). Don't add new synthetic-data performance claims; add a new dataset to `bench/benchmark.ts`'s registry instead.
- **Shared primitives over inline copies.** `computeH0Phase` (`src/core/h0.ts`), `UnionFind` (`src/core/unionfind.ts`), and `DenseWorkingCol` (`src/core/reduction.ts`) are used by every engine that needs them. An earlier audit found the H0 phase and union-find logic copy-pasted inline across five files with no compiler or test enforcing they stayed in sync — before adding a new engine, check whether an existing shared primitive already does what you need.
- **No premature allocation in hot, high-frequency paths.** `IncrementalH1` (the streaming engine) pools per-triangle/per-push retained and transient state into flat typed arrays / reused instances rather than allocating one small object per item per call — see its class docstring for the measured memory-blowup history this pattern fixed.

## Where to look first

- `src/index.ts` — the full public API surface, one file. Docstrings live in the individual implementation modules, not the barrel.
- `README.md`'s "Comparison Against Prior Work" section — the honest, measured (not claimed) performance and correctness story, including known limitations.
- `test/helpers.ts` — shared test utilities (seeded RNG, ground-truth topology generators) used across the suite.

# Writing style

Write in flowing technical prose, the way a sharp senior engineer talks in chat - direct, conversational, and confident. Not documentation, not a report, not a slide deck.

Rules:

1. **Answer exactly what was asked, at the length it deserves - err short.** A yes/no or confirmation question gets 2-4 sentences. A "which one should I pick" gets a few paragraphs. Only a genuinely multi-part design question earns a long answer. Before sending, cut any paragraph that doesn't change what the reader does next: background they didn't ask for, restating their situation back to them, generic advice ("monitor it", "measure first") they'd already know. Seven paragraphs where three would do is a style failure even if every paragraph is well-written.
2. **Every paragraph and every bullet carries a complete argument** - claim, mechanism, and consequence together. Never state a fact without saying why it matters in the same breath. Not "MoR increases scan cost, latency, and metadata overhead" but "MoR is cheap to write, but every read has to reconcile delete files against data files, so scans get slower and flakier until something compacts them - and now that's your problem to operate."
3. **Match the form to the content - and vary it.** A long answer whose every block has the same shape (all paragraphs, all bold-lead paragraphs, all bullets) is monotonous and hard to scan; real explanations mix forms because the content mixes kinds. Pick per part:

- **Distinct sections or comparison axes** (cost vs ops, "how generation works" vs "conventions") -> short bold headings on their own line, like "**The API reference is generated, not hand-written**" or "**Cost:**". A multi-axis comparison in undifferentiated paragraphs is a style failure just like a fragmented list is.
- **A genuine sequence** (pipeline stages, diagnostic steps, ranked guesses) -> a numbered list, each item opening with a short bolded lead phrase and continuing in full sentences (1-4 of them).
- **Genuinely parallel, enumerable facts** (the four config files involved, the three limits that apply) -> a plain bullet list; items may be a single full sentence when the facts are simple, and that's fine.
- **Reasoning, causality, narrative** -> paragraphs. Shortening never means flattening: when rule 1 says cut, cut sentences within the structure - don't collapse headings, lists, and sections into uniform paragraphs.

4. **Don't shred connected reasoning into bullets.** If items connect with "because"/"so"/"but", those connections are the content - write prose. And never a bolded label followed by a clipped noun phrase posing as a bullet.
5. **Open with the verdict and its central caveat in one or two plain sentences.** Not a bolded headline.
6. **Conversational but not dramatic.** Use contractions (it's, you'd, don't). Say "so" and "but", not "therefore" and "however". Never write scaffolding like "The deciding mechanism is", "It is worth noting", "Importantly". No theatrical labels or hype adjectives: no "**The poison**", "the trap", "brutally expensive", "the killer feature", "sharp edge", "absurdly cheap". State the actual problem in plain words - "this rewrites gigabytes to change megabytes" beats any dramatic framing.

- No staccato, short dramatic sentences. Let sentences breathe with commas, dependent clauses, and ideas linked together.
- No cheesy setup phrases that introduce a point instead of stating it. Never write "here's the thing", "here's the kicker", "the part nobody warns you about", "what nobody tells you", "the dirty secret", "the truth is", "plot twist", "the reality is", "here's what's wild". State the claim directly.
- No contrastive "not just X, but Y" structure or its variants ("it's not just X, it's Y", "not only X but also Y"). State the point directly instead of negating one framing to elevate another.

7. **No compression.** No dropped articles, no strings of abstract nouns where one concrete mechanism explains more. Shortness comes from cutting low-value content (rule 1), never from clipping sentences.
8. **End with a bottom line only when the answer weighed a real decision.** One plain-prose sentence: the call plus the condition that would flip it. Short factual or confirmation answers just end - no formulaic closer.

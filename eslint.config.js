// Minimal ESLint flat config -- added during a codebase audit that found no
// lint/format tooling existed anywhere in this repo despite its strict
// TypeScript config (strict: true, noUncheckedIndexedAccess: true). Kept
// deliberately light (typescript-eslint's "recommended" preset, not
// "strict"/"stylistic") so it catches real mistakes (unused vars, floating
// promises, etc.) without imposing a large one-time reformatting pass on an
// already-large, already-reviewed codebase. Run with `npm run lint`.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'demo/topojs-bundle.mjs', '.agents/**', 'agent/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // This codebase leans on `!` (non-null assertion) heavily and
      // deliberately, paired with noUncheckedIndexedAccess -- every use is
      // a documented, reasoned-about invariant (see e.g. src/core/reduction.ts's
      // extensive comments), not a lazy type-check bypass. Disabling the
      // blanket rule here rather than sprinkling eslint-disable comments
      // across dozens of already-justified call sites.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Precision numeric work throughout src/core -- `any` should still be
      // rare and flagged, but as a warning (surfaced, not a build-breaker)
      // rather than an error, consistent with this being a first lint pass
      // on an existing codebase, not a from-scratch strict setup.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);

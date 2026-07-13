import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // Minified esbuild output (single line, no whitespace) -- mirrors the same
  // exclusion oxlint.config.ts already applies for its rule-check pass.
  // Without this, `ultracite check`'s formatting pass flags this generated
  // file and the overall lint command exits non-zero even though the actual
  // lint rules (and everything else) pass clean.
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "demo/topojs-bundle.mjs",
  ],
});

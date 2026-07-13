import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

const disabled = [
  "no-plusplus",
  "func-style",
  "no-inline-comments",
  "no-non-null-assertion",
  "no-bitwise",
  "complexity",
  "no-use-before-define",
  "unicorn/no-array-for-each",
  "unicorn/filename-case",
  "unicorn/consistent-function-scoping",
  "unicorn/prefer-spread",
  "unicorn/prefer-math-trunc",
];

export default defineConfig({
  extends: [core, vitest],
  ignorePatterns: [...(core.ignorePatterns ?? []), "demo/topojs-bundle.mjs"],
  rules: Object.fromEntries(disabled.map((r) => [r, "off"])),
});

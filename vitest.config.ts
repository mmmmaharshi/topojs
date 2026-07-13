import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // dist/ contains the compiled output of `npm run build` (including
    // compiled copies of test/*.test.ts) — without this exclude, vitest's
    // default include glob picks those up too and every test runs twice.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});

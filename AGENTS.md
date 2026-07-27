# Pre-push checklist

Only push when all of these pass:

- `bun run lint` — 0 errors (ultracite check)
- `bun run build` — 0 errors (tsc)
- `bun test` — all tests pass

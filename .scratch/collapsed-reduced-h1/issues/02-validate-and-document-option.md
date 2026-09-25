# 02: Validate and document the public option

**What to build:** Make the opt-in reduced H1 behavior verifiable and understandable to callers. Run the existing differential corpus in both modes and document scope, defaults, and limits.

**Blocked by:** 01: Add the opt-in collapsed reduced-H1 path.

**Status:** ready-for-agent

- [x] Existing reduced tests run in default and collapsed modes.
- [x] Opt-in pairs match the independent reference or uncollapsed standard result.
- [x] A public-barrel test accepts the option through the unified API.
- [x] A type-level or declaration check accepts the new public option.
- [x] README and collapse documentation describe H0/H1 scope, default behavior, and non-applicability to other engines.
- [x] Dense-input tests do not assume that cost gates always remove an edge.

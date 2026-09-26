# Working agreement

## Sources of truth

- `package.json` defines the supported commands and quality gates.
- `mise.toml` defines the Node.js and pnpm versions used locally and in CI.
- `docs/design.md` records product intent and domain decisions.
- `config/dependency-cruiser.cjs` defines allowed dependency directions.
- `config/eslint.config.js` defines code constraints. Do not weaken rules or add overrides merely to make a change pass.

## Repository invariants

- The structured document is the source of truth; text and canvas are projections.
- Preserve stable identifiers and deterministic parsing, serialization, graph, and layout behavior.
- Production code must not depend on tests, routes, or outward architectural layers.
- Do not edit generated output under `.svelte-kit`, `.wrangler`, or `build`, or generated `worker-configuration.d.ts` files.

## Changes

- Install and run Node.js and pnpm through the versions pinned in `mise.toml`.
- Reuse the nearest existing pattern; do not introduce a parallel convention.
- Fix causes rather than suppressing errors or special-casing tests.
- Keep changes scoped. Do not format or refactor unrelated files.
- Do not reduce coverage, mutation, architecture, duplication, or lint thresholds without an explicit user decision. The global web and worker coverage thresholds are 90% by explicit user decision; this is not permission for agents to lower them further.

## Verification

- During development, run the narrowest relevant test or scenario.
- For observable behavior changes, update the nearest behavioral test.
- Use property tests for invariants and round trips, and E2E tests for browser flows.
- Writer loop: run `pnpm quality:precommit` (format modified files, then lint, knip, architecture and types), followed by `pnpm quality:fast` (coverage without property tests). `quality:precommit` checks the working tree: commit everything it validated.
- Integration: run `pnpm quality:integration` (property tests, Chromium E2E and snapshot performance). E2E is integration-only, not part of the writer loop.
- Before merging, run `pnpm check` (all the above, full web coverage with properties, incremental performance, other E2E browser projects, full formatting and build).
- The 90% web and worker coverage gates and this split between writer and integration loops were fixed by explicit user decision; all agents must otherwise preserve thresholds.

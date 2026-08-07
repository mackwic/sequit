# Working agreement

## Sources of truth

- `package.json` defines the supported commands and quality gates.
- `docs/design.md` records product intent and domain decisions.
- `.dependency-cruiser.cjs` defines allowed dependency directions.
- `eslint.config.js` defines code constraints. Do not weaken rules or add overrides merely to make a change pass.

## Repository invariants

- The structured document is the source of truth; text and canvas are projections.
- Preserve stable identifiers and deterministic parsing, serialization, graph, and layout behavior.
- Production code must not depend on tests, routes, or outward architectural layers.
- Do not edit generated output under `.svelte-kit`, `.wrangler`, or `build`, or generated `worker-configuration.d.ts` files.

## Changes

- Use Node.js 24 and the pnpm version pinned in `package.json`.
- Reuse the nearest existing pattern; do not introduce a parallel convention.
- Fix causes rather than suppressing errors or special-casing tests.
- Keep changes scoped. Do not format or refactor unrelated files.
- Do not reduce coverage, mutation, architecture, duplication, or lint thresholds.

## Verification

- During development, run the narrowest relevant test or scenario.
- For observable behavior changes, update the nearest behavioral test.
- Use property tests for invariants and round trips, and E2E tests for browser flows.
- Run `pnpm quality:fast` as the local implementation gate.
- Run `pnpm check` before merging.

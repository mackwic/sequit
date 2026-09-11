# Project configuration

This directory contains repository-wide tool configuration that can be selected explicitly by
the corresponding package script.

Configuration stays at the repository root when its tool requires or strongly benefits from
conventional discovery. This includes `package.json`, `pnpm-workspace.yaml`, `mise.toml`, `knip.json`,
and the root `tsconfig.json`. Worker-specific configuration remains beside the collaboration worker
so its scope and relative paths stay local.

The root `eslint.config.js` is a discovery adapter: it only re-exports the configuration stored
here, preserving root-relative file matching.

Custom ESLint rules live in `eslint/rules`. Each test is colocated with the rule it exercises.

The Vitest configuration gives each Stryker worker its own Vite cache using
`STRYKER_MUTATOR_WORKER`. Mutation runners share a sandbox, so a shared optimizer cache can fail
with `ENOTEMPTY` when concurrent runners publish their optimized dependencies. Ordinary Vitest
runs keep the default cache. Keep mutation concurrency and quality thresholds unchanged.

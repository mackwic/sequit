# sequit

## Source organisation

`src/app/web` contains the product's application layer and UI. `src/app/workshop` contains development-only experiments that reuse the editor. `src/lib/core` contains pure document and graph operations; `src/lib/infrastructure` contains technical implementations and shared session contracts. Worker entry points and their runtime-specific configuration live under `src/workers`, starting with `collaboration-worker`.

The workshop uses the same SvelteKit application at `/atelier` during development. Production builds exclude its modules and return 404 on that route. See [module boundaries](docs/architecture.md) for dependency rules and ownership.

## Local development

With [mise](https://mise.jdx.dev/) activated in your shell, install the pinned toolchain and project dependencies:

```bash
mise install
mise run install
```

`mise.toml` pins Node.js 24 LTS and pnpm 12. Dependency build permissions use `allowBuilds` in `pnpm-workspace.yaml`.

Keep `@types/node` on the Node.js 24 line. Vitest and its Istanbul coverage provider stay on 4.1 while `@cloudflare/vitest-pool-workers` requires Vitest 4; TypeScript stays on 6.0 while `typescript-eslint` requires TypeScript below 6.1. Recheck those peer dependency ranges before upgrading either major version.

Run the complete web and collaboration stack with:

```bash
mise run dev
```

Portless assigns free ports to Vite and Wrangler and exposes the web app over local HTTPS. The main checkout uses `https://sequit.localhost`; a linked Git worktree on branch `fix-canvas` uses `https://fix-canvas.sequit.localhost`. The `/collab` HTTP and WebSocket traffic stays behind the Vite proxy and targets the Wrangler instance belonging to the same worktree.

The first run can request administrator access to trust the local certificate authority and bind the HTTPS proxy. Stop `mise run dev` to remove its temporary route. Use `pnpm exec portless prune` to clean up an orphaned route after an interrupted process.

Run `mise run clean` (or `pnpm clean`) to remove generated builds, framework caches, coverage,
browser-test output, and mutation-test sandboxes. Installed dependencies and local environment files
are preserved.

## Local quality gates

Use `pnpm quality:fast` during implementation. It is the fast, fail-fast edit-loop gate and runs:

1. `pnpm lint` for correctness, readability, and production maintainability rules.
2. `pnpm quality:unused` to reject unused files, exports, and dependencies.
3. `pnpm quality:architecture` to enforce dependency directions.
4. `pnpm test:coverage` for the root Node and collaboration-worker Vitest suites.
5. `pnpm quality:duplicates` for token-aware production clone detection.

The fast gate enforces coverage rather than running ordinary Vitest twice. Each command is joined with `&&`; a failure stops later diagnostics from running.

Run `pnpm check` before merging; it is the authoritative local gate and adds formatting, all TypeScript and Svelte checks, Playwright browser tests, and both production builds. Mutation testing is separate: run `pnpm test:mutation` explicitly, or `pnpm test:mutation:weekly` to reproduce the intensive scheduled campaign.

### Diagnostic commands

| Command                            | Scope                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                        | All authored JavaScript, TypeScript, Svelte, tests, and configuration; production metrics cover `src/lib`, `src/app/web`, workshop fixture generators, and Worker sources |
| `pnpm quality:unused`              | Unused files, exports, and dependencies reported by Knip                                                                                                                  |
| `pnpm quality:architecture`        | Dependency boundaries and circular dependencies reported by dependency-cruiser                                                                                            |
| `pnpm test:coverage:web`           | Root Vitest suite with Istanbul coverage for `src/**/*.ts`, excluding Worker sources                                                                                      |
| `pnpm test:coverage:collaboration` | Cloudflare Vitest suite with Istanbul coverage for `src/workers/collaboration-worker/**/*.ts`                                                                             |
| `pnpm test:coverage`               | Both coverage suites in fail-fast order                                                                                                                                   |
| `pnpm quality:duplicates`          | TypeScript and Svelte under `src`, excluding tests and generated output                                                                                                   |
| `pnpm quality:fast`                | Lint, unused-code, architecture, coverage, and duplication gate                                                                                                           |
| `pnpm test:mutation`               | Stryker mutation testing for the complete selected critical modules                                                                                                       |
| `pnpm test:mutation:weekly`        | Intensive mutation campaign using the 5,000-case property-test fuzzing profile                                                                                            |
| `pnpm check`                       | Authoritative local gate: format, types, fast quality gate, browser tests, and production builds                                                                          |

### Enforced baselines

Authored code prohibits ternaries by default. Production TypeScript has global limits of 20 cyclomatic complexity, 15 cognitive complexity, 4 levels of nesting, 325 effective lines per file, 160 effective lines per function, 15 top-level functions, 4 parameters, and 40 statements per function. Narrow file-specific overrides in `config/eslint.config.js` preserve the measured baseline of existing parser, layout, collaboration, validation, graph, and document-pipeline hotspots without relaxing limits for other modules. Local rule implementations and their tests are colocated under `config/eslint/rules`.

Closed string domains use native string enums. ESLint rejects string literal types and `as const` string objects paired with a derived value-union alias (`typeof Values[keyof typeof Values]`); ordinary string configuration maps remain allowed.

The web and collaboration suites independently require 98% statements, branches, functions, and lines. Generated declarations, Svelte components, tests, and support files are outside these coverage scopes.

Duplication analysis uses mild token matching with a minimum clone size of 5 lines and 50 tokens. It scans production TypeScript and Svelte, excludes declarations, tests, generated output, builds, and reports, prints results only to the console, and fails when duplicated lines exceed 1%.

### Git hooks

`mise run install` runs `pnpm install`, which synchronizes SvelteKit and installs the tracked Husky hook. The pre-commit hook invokes pnpm through `mise exec`, so it uses the toolchain pinned in `mise.toml`. It runs lint-staged: staged JavaScript, TypeScript, and Svelte files must pass Prettier and ESLint, while other supported authored formats are checked with Prettier only. Commands receive only matching staged paths, so unrelated worktree files are not checked.

There is no pre-push quality gate: pushes do not repeat checks already run locally. Run the local quality gates explicitly and let CI validate pushed changes. Set `HUSKY=0` for non-developer or CI dependency installations that should skip hook installation; SvelteKit synchronization still runs before Husky observes that setting.

### Continuous integration

For every pull request and push to `main`, GitHub Actions uses `mise.toml` to install the pinned toolchain, then runs `pnpm check`. Mutation testing is not part of this workflow or any Git hook. The read-only check workflow cancels superseded runs for the same pull request or branch. The existing property-fuzzing job runs separately on Sundays.

The **Mutation testing** workflow runs every Friday at **03:17 UTC** on the default branch and can also be started manually with `workflow_dispatch`. It runs `pnpm test:mutation:weekly`: all nine selected critical files are mutated in full, including the previously restricted layout regions, and property tests use 5,000 cases instead of the normal 200. The initial test run may take up to ten minutes, the extra per-mutant timeout allowance is sixty seconds, and the job has a two-hour limit. The global mutation break threshold remains 80%.

HTML and JSON mutation reports are written to `coverage/mutation/` and uploaded as a GitHub Actions artifact retained for thirty days, including when the mutation threshold fails. The HTML entry point is `index.html`. A failed or interrupted initial run may not produce a report; the job log remains available. Scheduled runs do not cancel an ongoing campaign.

Run `pnpm check` locally to reproduce the PR/push gate in fail-fast order. For a focused mutation investigation, use `pnpm test:mutation --mutate src/lib/core/document/validate-logic-document.ts`; its score applies to the selected file, not the whole campaign. Fuzzing failures include a replay seed and path; set `SEQUIT_PROPERTY_SEED` when rerunning the weekly command to reproduce the seed.

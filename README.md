# sequit

## Local development

With [mise](https://mise.jdx.dev/) activated in your shell, install the pinned toolchain and project dependencies:

```bash
mise install
mise run install
```

Run the complete web and collaboration stack with:

```bash
mise run dev
```

Portless assigns free ports to Vite and Wrangler and exposes the web app over local HTTPS. The main checkout uses `https://sequit.localhost`; a linked Git worktree on branch `fix-canvas` uses `https://fix-canvas.sequit.localhost`. The `/collab` HTTP and WebSocket traffic stays behind the Vite proxy and targets the Wrangler instance belonging to the same worktree.

The first run can request administrator access to trust the local certificate authority and bind the HTTPS proxy. Stop `mise run dev` to remove its temporary route. Use `pnpm exec portless prune` to clean up an orphaned route after an interrupted process.

## Local quality gates

Use `pnpm quality:fast` during implementation. It is the fast, fail-fast edit-loop gate and runs:

1. `pnpm lint` for correctness, readability, and production maintainability rules.
2. `pnpm quality:unused` to reject unused files, exports, and dependencies.
3. `pnpm quality:architecture` to enforce dependency directions.
4. `pnpm test:coverage` for the root Node and collaboration-worker Vitest suites.
5. `pnpm quality:duplicates` for token-aware production clone detection.

The fast gate enforces coverage rather than running ordinary Vitest twice. Each command is joined with `&&`; a failure stops later diagnostics from running.

Run `pnpm quality` to add mutation testing for the selected critical modules. Run `pnpm check` before merging; it is the authoritative local gate and adds formatting, all TypeScript and Svelte checks, Playwright browser tests, both production builds, and mutation testing.

### Diagnostic commands

| Command                            | Scope                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                        | All authored JavaScript, TypeScript, Svelte, tests, and configuration; production metrics apply only to `src/lib/**/*.ts` and `workers/collaboration/src/**/*.ts` |
| `pnpm quality:unused`              | Unused files, exports, and dependencies reported by Knip                                                                                                          |
| `pnpm quality:architecture`        | Dependency boundaries and circular dependencies reported by dependency-cruiser                                                                                    |
| `pnpm test:coverage:web`           | Root Vitest suite with Istanbul coverage for `src/**/*.ts`                                                                                                        |
| `pnpm test:coverage:collaboration` | Cloudflare Vitest suite with Istanbul coverage for `workers/collaboration/src/**/*.ts`                                                                            |
| `pnpm test:coverage`               | Both coverage suites in fail-fast order                                                                                                                           |
| `pnpm quality:duplicates`          | TypeScript and Svelte under `src` and `workers/collaboration/src`                                                                                                 |
| `pnpm quality:fast`                | Lint, unused-code, architecture, coverage, and duplication gate                                                                                                   |
| `pnpm test:mutation`               | Stryker mutation testing for selected critical modules                                                                                                            |
| `pnpm quality`                     | Fast gate followed by mutation testing                                                                                                                            |
| `pnpm check:core`                  | Format, types, fast quality gate, browser tests, and production builds                                                                                            |
| `pnpm check`                       | Authoritative local gate: core checks followed by mutation testing                                                                                                |

### Enforced baselines

Authored code prohibits ternaries by default. Production TypeScript has global limits of 20 cyclomatic complexity, 15 cognitive complexity, 4 levels of nesting, 325 effective lines per file, 160 effective lines per function, 15 top-level functions, 4 parameters, and 40 statements per function. Narrow file-specific overrides in `eslint.config.js` preserve the measured baseline of existing parser, layout, collaboration, validation, graph, and document-pipeline hotspots without relaxing limits for other modules.

Closed string domains use native string enums. ESLint rejects string literal types and `as const` string objects paired with a derived value-union alias (`typeof Values[keyof typeof Values]`); ordinary string configuration maps remain allowed.

The web and collaboration suites independently require 98% statements, branches, functions, and lines. Generated declarations, Svelte components, tests, and support files are outside these coverage scopes.

Duplication analysis uses mild token matching with a minimum clone size of 5 lines and 50 tokens. It scans production TypeScript and Svelte, excludes declarations, tests, generated output, builds, and reports, prints results only to the console, and fails when duplicated lines exceed 1%.

### Git hooks

`mise run install` runs `pnpm install`, which synchronizes SvelteKit and installs the tracked Husky hooks. Both hooks invoke pnpm through `mise exec`, so they use the toolchain pinned in `mise.toml`. The pre-commit hook runs lint-staged: staged JavaScript, TypeScript, and Svelte files must pass Prettier and ESLint, while other supported authored formats are checked with Prettier only. Commands receive only matching staged paths, so unrelated worktree files are not checked.

The pre-push hook runs `pnpm quality:fast`; mutation testing is left to the parallel CI job or an explicit local `pnpm test:mutation`. Set `HUSKY=0` for non-developer or CI dependency installations that should skip hook installation; SvelteKit synchronization still runs before Husky observes that setting.

### Continuous integration

For every pull request and push to `main`, GitHub Actions uses `mise.toml` to install the pinned toolchain, then runs `pnpm check:core` and `pnpm test:mutation` as independent parallel jobs. Only the core job installs Chromium. The read-only workflow cancels superseded runs for the same pull request or branch.

Run `pnpm check` locally to reproduce both CI jobs in fail-fast order. Its namespaced output identifies whether formatting, types, linting, unused code, architecture, coverage, duplication, browser integration, a production build, or mutation testing failed.

# sequit

## Local development

Run the complete web and collaboration stack with:

```bash
pnpm dev
```

Portless assigns free ports to Vite and Wrangler and exposes the web app over local HTTPS. The main checkout uses `https://sequit.localhost`; a linked Git worktree on branch `fix-canvas` uses `https://fix-canvas.sequit.localhost`. The `/collab` HTTP and WebSocket traffic stays behind the Vite proxy and targets the Wrangler instance belonging to the same worktree.

The first run can request administrator access to trust the local certificate authority and bind the HTTPS proxy. Stop `pnpm dev` to remove its temporary route. Use `pnpm exec portless prune` to clean up an orphaned route after an interrupted process.

## Local quality gates

Use `pnpm quality:fast` during implementation. It is the fast, fail-fast edit-loop gate and runs:

1. `pnpm lint` for correctness, readability, and production maintainability rules.
2. `pnpm quality:unused` to reject unused files, exports, and dependencies.
3. `pnpm quality:architecture` to enforce dependency directions.
4. `pnpm test:coverage` for the root Node and collaboration-worker Vitest suites.
5. `pnpm quality:duplicates` for token-aware production clone detection.

The measured coverage chain completes comfortably within the approximately 10-second local budget, so the fast gate enforces coverage rather than running ordinary Vitest. Each command is joined with `&&`; a failure stops later diagnostics from running.

Run `pnpm quality` to add mutation testing for the selected critical modules. Run `pnpm check` before merging; it is the authoritative gate and adds formatting, all TypeScript and Svelte checks, Playwright browser tests, and both production builds. Coverage replaces the ordinary `pnpm test` step, so Vitest does not run twice.

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
| `pnpm check`                       | Authoritative format, types, quality, browser, and build gate                                                                                                     |

### Enforced baselines

Authored code prohibits ternaries by default. Production TypeScript has global limits of 20 cyclomatic complexity, 15 cognitive complexity, 4 levels of nesting, 325 effective lines per file, 160 effective lines per function, 15 top-level functions, 4 parameters, and 40 statements per function. Narrow file-specific overrides in `eslint.config.js` preserve the measured baseline of existing parser, layout, collaboration, validation, graph, and document-pipeline hotspots without relaxing limits for other modules.

The web and collaboration suites independently require 98% statements, branches, functions, and lines. Generated declarations, Svelte components, tests, and support files are outside these coverage scopes.

Duplication analysis uses mild token matching with a minimum clone size of 5 lines and 50 tokens. It scans production TypeScript and Svelte, excludes declarations, tests, generated output, builds, and reports, prints results only to the console, and fails when duplicated lines exceed 1%.

### Git hooks

`pnpm install` runs `svelte-kit sync` and installs the tracked Husky hooks. The pre-commit hook runs lint-staged: staged JavaScript, TypeScript, and Svelte files must pass Prettier and ESLint, while other supported authored formats are checked with Prettier only. Commands receive only matching staged paths, so unrelated worktree files are not checked.

The pre-push hook runs `pnpm quality`, blocking the push when the fast gate or mutation testing fails. Set `HUSKY=0` for non-developer or CI dependency installations that should skip hook installation; SvelteKit synchronization still runs before Husky observes that setting.

### Continuous integration

GitHub Actions runs the authoritative `pnpm check` gate for every pull request and every push to `main`. The read-only workflow uses the repository's pinned pnpm version with Node.js 24, installs Chromium and its system dependencies, and cancels superseded runs for the same pull request or branch.

Run `pnpm check` locally to reproduce a remote quality failure. Its namespaced output identifies whether formatting, types, linting, unused code, architecture, coverage, mutation testing, duplication, browser integration, or a production build failed.

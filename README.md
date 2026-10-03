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

## Document exports

The document menu exports TOML (`.sequit.toml`), Graphviz DOT (`.dot`), or an editable
Excalidraw scene (`.excalidraw`). TOML remains the complete Sequit document format.

DOT renders square cards with pastel headers using each document nature's label and color,
including custom natures. A node's own color overrides its nature's color. Card text uses
the same compact Markdown projection as the canvas: supported inline formatting and
escaped punctuation become readable text; unsupported markup remains literal.
Groups are labeled frames, and relations to external endpoints attach to their boundaries.
Identifiers and relation directions are preserved, but Graphviz calculates its own placement
and orthogonal routes rather than reproducing the Sequit canvas geometry.

With Graphviz installed, render an exported document as a vector image:

```bash
dot -Tsvg document.dot -o document.svg
```

Excalidraw instead retains the current canvas shapes and routes.

## Analytics and privacy

PostHog EU is enabled in production and disabled in local development by default. The public
project token defaults to Sequit's project; `.env.example` documents `PUBLIC_POSTHOG_KEY` and
`PUBLIC_POSTHOG_ENABLED`. Set the latter to `true` to exercise the integration locally, or `false`
to disable it. These are public configuration values, not personal API credentials.

The browser sends pageviews, editor actions and technical diagnostics through the same-origin SvelteKit route `/ingest`. The proxy uses
fixed PostHog EU API and asset hosts, strips credentials, cookies, referrers and visitor IP
headers, and does not follow upstream redirects. Pageviews contain the SvelteKit route template,
never document identifiers, query parameters, fragments or graph content. The workshop is excluded.

Both workspaces send their editor batches through `dispatchEditorAction`
(`src/app/web/analytics/editor-actions.ts`), which names each accepted batch from its commands and
counts it with the same identity and route template as pageviews: `node_created` (with `linked`
when typed from an existing box), `nodes_pasted` (several boxes), `nodes_linked`,
`node_nature_changed`, `selection_deleted`, `elements_moved`, `group_created`, `group_edited`,
`group_dissolved`, `group_toggled`, `junction_inserted`, `junction_edited`, `nature_created`,
`nature_edited`, `nature_deleted`, `natures_imported`, `layout_changed` and `lanes_edited`.
Undo and redo replay history and are not counted. A group or nature label is shared text: the
single-user editor counts its rename when the dialog saves it, while live label edits in a
collaborative session send no command and are not counted.

The document page also counts `document_created` (a blank document from the menu),
`document_imported` (a file opened), `collaboration_started` (a room created; joining one is not
counted) and `document_exported` with its `format`: `sequit`, `dot`, `excalidraw`, `png`, `svg`
or `clipboard`. The only properties are an element `count`, the `linked` flag and the export
`format`; labels, text, colours, file names and identifiers are never sent.

Before consent, and after refusal or withdrawal, visits use PostHog's cookieless mode without
analytics browser storage. Accepting allows a pseudonymous identifier in local storage to
recognize repeat visits. The consent panel shows until a choice is made, then hides; the
**Consent / Consentement** entry of the document menu brings it back to change the choice at any
time. The consent choice itself is stored separately. Browser DNT/GPC signals prevent persisted
tracking. This consent controls repeat-visit analytics only, not technical diagnostics.

A separate `sequitDiagnostics` SDK instance captures session replay, console logs and unhandled
errors/rejections before consent and after refusal. Its randomly generated identity and session
exist only in memory and reset on reload; they are never linked to the persisted analytics identity.
Person profiles, DOM autocapture events, surveys, feature-flag evaluation and visitor geolocation
are disabled. Diagnostics are pseudonymous, not a guarantee of anonymous data.

Replay masks all text and inputs, blocks editable fields, images, media, embedded content and
canvas pixels, and removes document/participant identifiers and arbitrary DOM attributes.
Only approved HTML/SVG geometry, static application stylesheet links, interaction coordinates,
viewport metadata and safe route templates survive the final payload filter. The SDK's URL-only
navigation masking callback preserves this metadata without keeping document URLs. Arbitrary
styles, network headers and bodies, JSON-LD, plugin/custom events and opaque packed snapshots
do not pass this filter.
Per-event replay compression is disabled so the filter can inspect every event; transport
compression remains available.

All free-form console log bodies and error messages become `[redacted]`. Logs retain severity,
timing, ephemeral correlation and the safe route, not caller-supplied attributes. Exceptions
retain approved error types, application error class names, and application frames: their
script URL, line/column position and code function name, but not source contexts, custom fields
or raw browser URLs. Production builds publish source maps next to their chunks, so PostHog
resolves these frames to the original source; the repository is public, so the maps disclose
nothing new. Existing layout reports keep their document text and identifier anonymization and
are not sent to PostHog.

**Enable cookieless tracking and Session Replay in the PostHog project settings before deployment.**
Cookieless ingestion can answer HTTP 200 while the project discards those events; replay requires
the project's real remote configuration. Without forwarding visitor IPs, treat cookieless
measurements as visit counts, not reliable unique-visitor counts or geolocation. Separating
technical diagnostics from analytics consent is a product policy, not a legal guarantee of
consent exemption or legitimate interest.

## Deployment

Authenticate once, then deploy both Workers:

```bash
mise run deploy:login
mise run deploy
```

The task deploys `sequit-collaboration` first, because the `sequit` web Worker binds to it as the `COLLABORATION` service, then builds and deploys the web Worker. `pnpm deploy:collaboration` and `pnpm deploy:web` deploy each Worker separately.

Wrangler creates the R2 bucket `sequit-room-archive` on the first deploy. Two settings live outside the code: the WAF rate-limiting rule on `/collab/*` and the R2 lifecycle rule for archive retention, both described in [the design notes](docs/design.md).

## Local quality gates

During implementation, run `pnpm quality:precommit`, then `pnpm quality:fast`. The precommit
script formats modified files with the repository Prettier configuration, then checks lint, unused
code, architecture, and types. It checks the working tree: commit everything it validated.

`quality:fast` is the fail-fast writer gate: full lint, Knip, architecture, web coverage **without**
`*.property.test.ts` files, worker coverage, then duplicate detection. Property tests are reserved
for `pnpm quality:integration`, which runs all properties, Chromium E2E, and snapshot performance.
E2E is not part of the writer loop. The individual scripts are joined with `&&`, stopping on failure.

Run `pnpm check` before merging. It adds format checking, full web coverage **including** property
tests, incremental performance, the other Playwright browser projects, TypeScript/Svelte checks,
and both production builds to the writer and integration gates. Mutation testing is separate: run
`pnpm test:mutation` explicitly, or `pnpm test:mutation:weekly` for the intensive campaign.

### Diagnostic commands

| Command                            | Scope                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                        | All authored JavaScript, TypeScript, Svelte, tests, and configuration; production metrics cover `src/lib`, `src/app/web`, workshop fixture generators, and Worker sources |
| `pnpm quality:unused`              | Unused files, exports, and dependencies reported by Knip                                                                                                                  |
| `pnpm quality:architecture`        | Dependency boundaries and circular dependencies reported by dependency-cruiser                                                                                            |
| `pnpm test:coverage:web:fast`      | Web coverage without property tests; used by `quality:fast`                                                                                                               |
| `pnpm test:coverage:web`           | Complete root Vitest suite including properties, with Istanbul coverage for web sources                                                                                   |
| `pnpm test:coverage:collaboration` | Cloudflare Vitest suite with Istanbul coverage for `src/workers/collaboration-worker/**/*.ts`                                                                             |
| `pnpm test:coverage`               | Both coverage suites in fail-fast order                                                                                                                                   |
| `pnpm quality:duplicates`          | TypeScript and Svelte under `src`, excluding tests and generated output                                                                                                   |
| `pnpm i18n:compile`                | Regenerate the Paraglide message modules in `src/app/web/i18n/paraglide` from `messages/` (also run by install, `quality:precommit`, and `check`)                         |
| `pnpm quality:precommit`           | Format modified working-tree files, then lint, unused-code, architecture, and types checks                                                                                |
| `pnpm quality:fast`                | Lint, unused-code, architecture, web coverage without properties, worker coverage, and duplication gate                                                                   |
| `pnpm quality:integration`         | Property tests, Chromium E2E, and snapshot performance                                                                                                                    |
| `pnpm test:mutation`               | Stryker mutation testing for the complete selected critical modules                                                                                                       |
| `pnpm test:mutation:weekly`        | Intensive mutation campaign using the 5,000-case property-test fuzzing profile                                                                                            |
| `pnpm check`                       | Merge gate: format, types, fast and integration gates, complete web coverage, incremental performance, other browsers, builds                                             |

### Enforced baselines

Authored code prohibits ternaries by default. Production TypeScript has global limits of 20 cyclomatic complexity, 15 cognitive complexity, 4 levels of nesting, 325 effective lines per file, 160 effective lines per function, 15 top-level functions, 4 parameters, and 40 statements per function. Narrow file-specific overrides in `config/eslint.config.js` preserve the measured baseline of existing parser, layout, collaboration, validation, graph, and document-pipeline hotspots without relaxing limits for other modules. Local rule implementations and their tests are colocated under `config/eslint/rules`.

Closed string domains use native string enums. ESLint rejects string literal types and `as const` string objects paired with a derived value-union alias (`typeof Values[keyof typeof Values]`); ordinary string configuration maps remain allowed.

The web and collaboration suites independently require 90% statements, branches, functions, and lines, by explicit user decision. Generated declarations, Svelte components, and test files are outside these coverage scopes; selected test-support utilities are included in web coverage.

Duplication analysis uses mild token matching with a minimum clone size of 5 lines and 50 tokens. It scans production TypeScript and Svelte, excludes declarations, tests, generated output, builds, and reports, prints results only to the console, and fails when duplicated lines exceed 1%.

### Git hooks

`mise run install` runs `pnpm install`, which synchronizes SvelteKit and installs the tracked Husky hook. The pre-commit hook invokes pnpm through `mise exec`, so it uses the toolchain pinned in `mise.toml`. It runs lint-staged: staged JavaScript, TypeScript, and Svelte files must pass Prettier and ESLint, while other supported authored formats are checked with Prettier only. Commands receive only matching staged paths, so unrelated worktree files are not checked.

There is no pre-push quality gate: pushes do not repeat checks already run locally. Run the local quality gates explicitly and let CI validate pushed changes. Set `HUSKY=0` for non-developer or CI dependency installations that should skip hook installation; SvelteKit synchronization still runs before Husky observes that setting.

### Continuous integration

For every pull request and push to `main`, GitHub Actions uses `mise.toml` to install the pinned toolchain, then runs `pnpm check`. Mutation testing is not part of this workflow or any Git hook. The read-only check workflow cancels superseded runs for the same pull request or branch. The existing property-fuzzing job runs separately on Sundays.

The **Mutation testing** workflow runs every Friday at **03:17 UTC** on the default branch and can also be started manually with `workflow_dispatch`. It runs `pnpm test:mutation:weekly`: all nine selected critical files are mutated in full, including the previously restricted layout regions, and property tests use 5,000 cases instead of the normal 200. The initial test run may take up to ten minutes, the extra per-mutant timeout allowance is sixty seconds, and the job has a two-hour limit. The global mutation break threshold remains 80%.

HTML and JSON mutation reports are written to `coverage/mutation/` and uploaded as a GitHub Actions artifact retained for thirty days, including when the mutation threshold fails. The HTML entry point is `index.html`. A failed or interrupted initial run may not produce a report; the job log remains available. Scheduled runs do not cancel an ongoing campaign.

Run `pnpm check` locally to reproduce the PR/push gate in fail-fast order. For a focused mutation investigation, use `pnpm test:mutation --mutate src/lib/core/document/validate-logic-document.ts`; its score applies to the selected file, not the whole campaign. Fuzzing failures include a replay seed and path; set `SEQUIT_PROPERTY_SEED` when rerunning the weekly command to reproduce the seed.

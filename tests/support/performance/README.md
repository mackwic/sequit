# Layout Performance Benchmarks

This opt-in suite reports machine-specific snapshot costs for graph creation, topological ranking, and the public `layoutGraph` boundary, plus one-node-at-a-time computational replay. It is a Node benchmark: TOML parsing, Yjs updates, DOM measurement, Svelte rendering, SVG routing presentation, and paint are outside its scope. Benchmark commands remain outside `pnpm check`.

## Commands

- `pnpm benchmark:layout` runs the 60-case layout matrix.
- `pnpm benchmark:graph` runs the same 60 cases once for graph creation and once for ranking.
- `pnpm benchmark:performance` runs graph reporting followed by layout reporting.
- `pnpm test:performance` runs the opt-in calibrated snapshot regression gate.
- `pnpm benchmark:incremental` reports stage p50, p95, and maximum insertion latency.
- `pnpm test:incremental-performance` runs calibrated incremental gates and reports fixed UX goals.

`pnpm exec vitest bench --run --config config/vitest.performance.config.ts tests/lib/core/layout/performance/long-relation-layout.bench.ts` measures a 100- or 1000-node chain with one additional relation from its last node to its first. Unlike the matrix's adjacent-rank `long-queue`, this profile activates obstacle routing without junctions. It reuses the same prepared-input boundary and sampling policy, reports timings, and introduces no calibrated budget.

The normal `pnpm test:web` configuration excludes `tests/**/performance/**`. The dedicated `config/vitest.performance.config.ts` uses the Node environment, disables coverage, and runs files serially.

## Workload Matrix

Every topology runs at 10, 19, 50, 100, and 1000 requested semantic nodes. Requested node count never includes supporting groups or junctions. Case labels report requested nodes, groups, junctions, rankable endpoints, semantic relations, and current graph adjacency edges so differently sized supporting structures remain visible.

The pure generators and node-count matrix are shared with the UI workshop in `src/app/workshop/fixtures/layout-performance/`. Browser rendering and interactive feedback can be explored at `/atelier`; benchmark timing still covers only the boundaries below.

The authoritative topology contracts and diagrams live in `tests/support/scenarios/layout-performance/README.md`. In brief:

- `long-queue`: one semantic node per rank in a single chain.
- `binary-tree`: breadth-first binary-tree insertion with a partial final level.
- `unbalanced`: square-shell ranks with one predecessor per target and a fixed 80% dominant source.
- `unbalanced-random`: the same shape with a fixed-seed dominant source per transition.
- `subgroups`: binary-tree edges, 10% prefix-stable root nodes, and two top-level groups.
- `nested-subgroups`: a node chain with one increasingly nested direct group per node.
- `wide-bipartite-layers`: complete adjacency between neighboring square-shell ranks.
- `repeated-diamonds`: consecutive fan-out/fan-in motifs sharing merge nodes.
- `disconnected-components`: deterministic two-node chains and an optional isolated node.
- `junction-heavy`: a node chain with one additional XOR junction between adjacent semantic nodes.
- `group-relations`: square-shell sibling groups connected directly by semantic group relations.
- `shallow-groups`: binary-tree edges with non-nested sibling groups of at most nine nodes.

`group-relations` expands relations between populated groups across their descendant members. Its adjacency metadata includes these effective Cartesian dependencies. The initial calibration below predates this behavior: its 5 ms incremental budget measured direct group endpoints with independent rank-zero members, so that historical workload is not equivalent to the current one. `junction-heavy` likewise reflects current production ranking, where both edges around a junction advance rank.

## Fixed Inputs

Builders use `top-to-bottom` direction with `top` bias and stable fixed-width IDs. Synthetic measurements match the shared layout test defaults:

| Entity   | Measurement                             |
| -------- | --------------------------------------- |
| Node     | 220 x 116                               |
| Junction | 32 x 32                                 |
| Group    | minimum 160 x 72, header 36, padding 24 |

Scenarios are built and validated before benchmark registration. The immutable prepared products are reused by each sample; benchmark callbacks do not mutate them or retain prior layout results.

## Stage Boundaries

| Benchmark group     | Prepared before timing                      | Timed callback                                  |
| ------------------- | ------------------------------------------- | ----------------------------------------------- |
| `createGraph`       | Valid immutable `LogicDocument` snapshot    | `createGraph(document)`                         |
| `topologicallyRank` | Successfully created immutable `LogicGraph` | `topologicallyRank(graph)`                      |
| `layoutGraph`       | Graph, ranks, and synthetic measurements    | Await `layoutGraph(graph, ranks, measurements)` |

Validation, scenario generation, graph/rank preparation for layout, measurement construction, workload metadata, and correctness assertions are outside timed callbacks. Graph creation intentionally returns a fresh result each iteration. Ranking always starts from a graph built successfully before registration, and layout always starts from the output of both preceding stages.

## Sampling Policy

Each registration uses a fixed 250 ms warmup and at least 1000 ms of measured sampling. Sampling duration, rather than a fixed iteration count, allows fast cases to collect many observations without making slow cases unbounded. Vitest's benchmark table is the detailed report; generated machine-specific output is not committed as a golden baseline.

## Calibrated Snapshot Budgets

The gate warms each prepared case three times, records 11 independent public-API durations with `performance.now()`, and compares their median with the strict upper bound below. The complete matrix is materialized in `snapshot-layout-budgets.ts`; 59 cells retain the ticket draft and one locally contradicted cell is calibrated independently.

| Scenario                  |     10 |     19 |     50 |    100 |    1000 |
| ------------------------- | -----: | -----: | -----: | -----: | ------: |
| `long-queue`              | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `binary-tree`             | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `unbalanced`              | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `unbalanced-random`       | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `subgroups`               | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `nested-subgroups`        | <10 ms | <10 ms | <30 ms | <50 ms | <205 ms |
| `wide-bipartite-layers`   | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `repeated-diamonds`       | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `disconnected-components` | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `junction-heavy`          | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `group-relations`         | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `shallow-groups`          | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |

## Recording Results

Benchmark values are meaningful only with machine and runtime context. Record the date and command along with:

```text
git rev-parse HEAD
node --version
pnpm --version
uname -a
sysctl -n machdep.cpu.brand_string  # macOS
```

Also note whether the machine was otherwise idle and whether it was using battery or external power. The separate budget command introduced during calibration remains opt-in; local reports from different machines should not be compared as interchangeable baselines.

## Initial Calibration

Calibration ran three consecutive times on 2026-07-31 at 16:56-16:57 +0200 with no other intentional workload. The machine was connected to AC power with its battery charged. The working tree was based on the Phase 2 commit; the Phase 3 gate and policy were uncommitted during measurement.

| Environment | Recorded value                                     |
| ----------- | -------------------------------------------------- |
| Base commit | `c42c7fe766698ae8a4b55ba8e802409cd9501b2d`         |
| Node        | `v22.15.0`                                         |
| pnpm        | `10.34.1`                                          |
| OS          | macOS Darwin 25.5.0, arm64 (`RELEASE_ARM64_T6000`) |
| CPU         | Apple M1 Max                                       |
| Power       | AC power, battery 100% charged                     |
| Command     | `pnpm test:performance`                            |

The values below are the worst median in milliseconds from the three calibration runs, not benchmark throughput or whole-test duration.

| Scenario                  |    10 |    19 |    50 |   100 |    1000 |
| ------------------------- | ----: | ----: | ----: | ----: | ------: |
| `long-queue`              | 0.028 | 0.046 | 0.114 | 0.239 |   1.621 |
| `binary-tree`             | 0.016 | 0.030 | 0.075 | 0.149 |   1.562 |
| `unbalanced`              | 0.017 | 0.027 | 0.071 | 0.121 |   1.441 |
| `unbalanced-random`       | 0.012 | 0.023 | 0.062 | 0.127 |   1.370 |
| `subgroups`               | 0.047 | 0.034 | 0.081 | 0.154 |   1.736 |
| `nested-subgroups`        | 0.045 | 0.117 | 0.463 | 1.740 | 136.079 |
| `wide-bipartite-layers`   | 0.018 | 0.039 | 0.168 | 0.460 |  15.162 |
| `repeated-diamonds`       | 0.014 | 0.026 | 0.069 | 0.129 |   1.557 |
| `disconnected-components` | 0.014 | 0.026 | 0.069 | 0.139 |   1.400 |
| `junction-heavy`          | 0.026 | 0.051 | 0.144 | 0.303 |   3.556 |
| `group-relations`         | 0.026 | 0.043 | 0.093 | 0.174 |   1.834 |
| `shallow-groups`          | 0.014 | 0.026 | 0.105 | 0.137 |   2.355 |

Only `nested-subgroups` at 1000 nodes exceeded its ticket draft in all three runs: 132.863 ms, 136.079 ms, and 132.626 ms. Applying the calibration rule to the 136.079 ms worst median gives `ceil(136.079 * 1.5 / 5) * 5 = 205 ms`. This topology creates 1000 levels of containment and exercises the layout engine's depth-sensitive group-envelope work; no other matrix cell is weakened.

## Incremental Replay

Incremental mode precomputes the same insertion transactions used by correctness replay, then starts from the scenario's empty document and applies all 1000 transactions in order. Insertion generation, summary calculation, assertion formatting, and terminal output are outside recorded insertion durations. Each measured insertion includes:

```text
immutable document update
  -> validateLogicDocument
  -> createGraph
  -> topologicallyRank
  -> createCanvasMeasurementModel
  -> layoutMeasurementsFor
  -> await layoutGraph
```

The report records document update, validation, graph creation, ranking, semantic measurement projection, synthetic measurement construction, layout, synchronous projection, and total latency separately. `synchronousProjectionMs` covers validation through semantic measurement projection. `totalMs` begins before immutable transaction application and ends after layout resolves, so it also includes synthetic measurement construction even though that work is not browser DOM measurement.

The initial node at index 0 seeds each topology. Growth buckets cover subsequent zero-based insertion indexes `1-9`, `10-19`, `20-49`, `50-99`, and `100-999`; the final bucket therefore ends with the insertion that produces 1000 semantic nodes. Reporting also samples the exact 10, 19, 50, 100, and 1000-node checkpoints. Every topology receives one warm replay and three complete measured replays, and corresponding insertion samples are aggregated before calculating nearest-rank p95.

### Regression Baselines

The opt-in gate compares total computational p95 in each growth bucket with the explicit matrix below. Calibration uses the worst p95 from three consecutive gate runs, adds 50% headroom, and rounds upward to a 5 ms boundary: `ceil(worstP95 * 1.5 / 5) * 5`. These values detect regressions on comparable hardware; they do not redefine the separate UX goals.

| Scenario                  | 1-9 | 10-19 | 20-49 | 50-99 | 100-999 |
| ------------------------- | --: | ----: | ----: | ----: | ------: |
| `long-queue`              |   5 |     5 |     5 |     5 |       5 |
| `binary-tree`             |   5 |     5 |     5 |     5 |       5 |
| `unbalanced`              |   5 |     5 |     5 |     5 |       5 |
| `unbalanced-random`       |   5 |     5 |     5 |     5 |       5 |
| `subgroups`               |   5 |     5 |     5 |     5 |       5 |
| `nested-subgroups`        |   5 |     5 |     5 |     5 |     200 |
| `wide-bipartite-layers`   |   5 |     5 |     5 |     5 |      70 |
| `repeated-diamonds`       |   5 |     5 |     5 |     5 |       5 |
| `disconnected-components` |   5 |     5 |     5 |     5 |       5 |
| `junction-heavy`          |   5 |     5 |     5 |     5 |      10 |
| `group-relations`         |   5 |     5 |     5 |     5 |       5 |
| `shallow-groups`          |   5 |     5 |     5 |     5 |      10 |

All values are strict upper bounds in milliseconds.

### Incremental Calibration

Calibration ran three consecutive times on 2026-07-31 at 17:22-17:39 +0200 with no other intentional workload. The machine remained connected to AC power. The working tree was based on the Phase 3 commit; the Phase 4 replay and gate were uncommitted during measurement.

| Environment | Recorded value                                     |
| ----------- | -------------------------------------------------- |
| Base commit | `31c971b`                                          |
| Node        | `v22.15.0`                                         |
| pnpm        | `10.34.1`                                          |
| OS          | macOS Darwin 25.5.0, arm64 (`RELEASE_ARM64_T6000`) |
| CPU         | Apple M1 Max                                       |
| Power       | AC power, battery charged                          |
| Command     | `pnpm test:incremental-performance`                |

The values below are the worst total p95 in milliseconds from the three runs. They aggregate all corresponding insertion samples in each growth bucket, not whole-replay duration.

| Scenario                  |   1-9 | 10-19 | 20-49 | 50-99 | 100-999 |
| ------------------------- | ----: | ----: | ----: | ----: | ------: |
| `long-queue`              | 0.026 | 0.068 | 0.282 | 0.210 |   2.304 |
| `binary-tree`             | 0.048 | 0.142 | 0.110 | 0.213 |   2.241 |
| `unbalanced`              | 0.022 | 0.053 | 0.108 | 0.220 |   2.199 |
| `unbalanced-random`       | 0.047 | 0.053 | 0.112 | 0.228 |   2.402 |
| `subgroups`               | 0.049 | 0.348 | 0.146 | 0.290 |   2.357 |
| `nested-subgroups`        | 0.042 | 0.438 | 0.466 | 1.445 | 133.123 |
| `wide-bipartite-layers`   | 0.046 | 2.862 | 0.489 | 1.367 |  45.622 |
| `repeated-diamonds`       | 0.023 | 0.049 | 0.117 | 0.473 |   2.941 |
| `disconnected-components` | 0.019 | 0.050 | 0.128 | 0.204 |   2.202 |
| `junction-heavy`          | 0.064 | 0.105 | 0.341 | 0.854 |   6.145 |
| `group-relations`         | 0.034 | 0.068 | 0.154 | 0.256 |   2.675 |
| `shallow-groups`          | 0.024 | 0.048 | 0.126 | 0.253 |   3.716 |

### Fixed UX Goals And Known Gaps

The fixed goals are synchronous projection p95 below 16 ms and total computational p95 below 50 ms. Calibration never raises these goals. The calibrated runs identify two gaps in the `100-999` bucket:

- `nested-subgroups` misses the total goal, with worst total p95 133.123 ms; its deeply nested group-envelope layout remains main-thread work despite the promise boundary.
- `wide-bipartite-layers` misses the synchronous goal, with observed synchronous p95 up to 29.512 ms; its total p95 remains below 50 ms in calibration.

All other topology/bucket goal results pass in these runs. The gate emits `PASS` or `GAP` for every topology and bucket and reports the slowest insertion index with all stage durations. Goal gaps remain visible but do not fail the machine-specific regression gate.

This synthetic Node replay is a main-thread computational proxy, not proof that the browser UI stays responsive. True interaction validation requires a public add-node operation and browser instrumentation around that action, including event-loop delay or long tasks, real DOM measurement, Svelte updates, and paint. Those facilities do not exist yet and are not invented by this suite.

## Reproducible before/after reports

Use the pinned runtime (`mise exec -- pnpm ...`) and finish other validation runs first. The recorder uses the existing snapshot or incremental tests, their workloads, warmups, samples and strict budgets. It does not recalibrate thresholds. It saves precise measurements, snapshot samples or incremental stage summaries, the Vitest report and a log next to the requested JSON file.

```sh
mise exec -- pnpm performance:record snapshot /tmp/layout-before.json 'wide-bipartite-layers/nodes=1000'
# Make the engine change, then finish correctness checks before measuring again.
mise exec -- pnpm performance:record snapshot /tmp/layout-after.json 'wide-bipartite-layers/nodes=1000'
mise exec -- pnpm performance:compare /tmp/layout-before.json /tmp/layout-after.json
```

Omit the last argument for the full snapshot matrix. Use `incremental` for one-node-at-a-time replay, optionally filtering by scenario name. The equivalent mise tasks are `mise run performance:record snapshot /tmp/layout-before.json 'wide-bipartite-layers/nodes=1000'` and `mise run performance:compare /tmp/layout-before.json /tmp/layout-after.json`.

Each report identifies the machine, runtime, measurement protocol and source fingerprint, including uncommitted and untracked source files. A changed source fingerprint during the run invalidates the report. Comparison rejects different machines, runtimes, protocols, filters, budgets or case sets, as well as incomplete reports. Keep output outside the source tree. Existing report files are never overwritten.

Record power and load conditions with `SEQUIT_PERFORMANCE_NOTE='AC power; other applications idle'`. A shared worktree lock prevents two recorders running on the same repository. The recorder refuses to start alongside known heavy validation tools and checks for competing validation processes every two seconds during execution. This is a best-effort check: it cannot guarantee an idle machine or detect every short-lived process. After an interrupted recorder, remove the `sequit-performance.lock` directory under the Git common directory only after checking that the original run has stopped.

The recorder keeps the test exit code: an over-budget run still exits unsuccessfully and produces a usable report. Incremental assertions collect all growth buckets even if an earlier bucket exceeds its budget. The comparison classifies each measured case as:

- **Nouveau dépassement**: within budget before, over budget after. Comparison exits unsuccessfully.
- **Dépassement déjà présent**: over budget in both reports. The measured delta remains visible; this label does not excuse an additional slowdown.
- **Retour dans le budget**: over budget before, within budget after.
- **Dans le budget**: within budget in both reports.

A comparison with only existing failures exits successfully; that means no _new budget failure_, not that the performance suite is green. Small differences from a single pair are not evidence of a speedup: repeat the pair under the same conditions when a result is close to its budget or a decision depends on the delta.

The previous engine investigation observed existing incremental overruns in `wide-bipartite-layers/100-999` and `group-relations/100-999`. They remain subject to their unchanged budgets. A fresh baseline, rather than an allowlist, determines whether a failure is already present.

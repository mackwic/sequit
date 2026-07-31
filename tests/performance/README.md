# Layout Performance Benchmarks

This opt-in suite reports machine-specific snapshot costs for graph creation, topological ranking, and the public `layoutGraph` boundary. It is a Node computational benchmark: TOML parsing, Yjs updates, DOM measurement, Svelte rendering, SVG routing presentation, and paint are outside its scope. Benchmark commands remain outside `pnpm check`.

## Commands

- `pnpm benchmark:layout` runs the 60-case layout matrix.
- `pnpm benchmark:graph` runs the same 60 cases once for graph creation and once for ranking.
- `pnpm benchmark:performance` runs graph reporting followed by layout reporting.

The normal `pnpm test:web` configuration excludes `tests/performance/**`. The dedicated `vitest.performance.config.ts` uses the Node environment, disables coverage, and runs files serially.

## Workload Matrix

Every topology runs at 10, 19, 50, 100, and 1000 requested semantic nodes. Requested node count never includes supporting groups or junctions. Case labels report requested nodes, groups, junctions, rankable endpoints, semantic relations, and current graph adjacency edges so differently sized supporting structures remain visible.

The authoritative topology contracts and diagrams live in `tests/scenarios/layout-performance/README.md`. In brief:

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

`group-relations` measures current production behavior: groups are direct rankable relation endpoints and their member nodes remain independent rank-zero endpoints. Its adjacency metadata is not descendant-expanded Cartesian adjacency. `junction-heavy` likewise reflects current production ranking, where both edges around a junction advance rank.

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

## Draft Snapshot Budgets

These uncalibrated median targets come directly from the ticket. They are policy documentation in Phase 2, not an enforced gate. Every cell is explicit so later calibration can adjust a single topology and size without weakening an entire column.

| Scenario                  |     10 |     19 |     50 |    100 |    1000 |
| ------------------------- | -----: | -----: | -----: | -----: | ------: |
| `long-queue`              | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `binary-tree`             | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `unbalanced`              | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `unbalanced-random`       | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `subgroups`               | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
| `nested-subgroups`        | <10 ms | <10 ms | <30 ms | <50 ms | <100 ms |
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

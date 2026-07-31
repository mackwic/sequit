# Layout Performance Scenarios

These builders are deterministic, prefix-stable test workloads. Requested counts always mean semantic nodes; groups and junctions are additional endpoints. Every snapshot uses `top-to-bottom` direction, `top` bias, fixed-width IDs, and the repository's synthetic measurements.

## long-queue

One node occupies each logical rank. Node `i - 1` is the sole predecessor of node `i`. Implemented by `builders/long-queue-scenario.ts`.

```mermaid
flowchart LR
    n0["node 0<br/>rank 0"] --> n1["node 1<br/>rank 1"] --> n2["node 2<br/>rank 2"] --> more["*"]
```

`*` continues the queue with exactly one node in each subsequent rank.

## binary-tree

Nodes use breadth-first order. Every node `i > 0` has parent `floor((i - 1) / 2)`, every parent has at most two children, and the final level may be partial. Implemented by `builders/binary-tree-scenario.ts`.

```mermaid
flowchart TB
    n0["node 0"] --> n1["node 1"] & n2["node 2"]
    n1 --> n3["node 3"] & n4["node 4"]
    n2 --> n5["node 5"] & more["*"]
```

`*` denotes the optional continuation into a partial final level.

## unbalanced

Node `i` occupies append-only rank `floor(sqrt(i))`, giving complete rank widths `1, 3, 5, ...`. Every node after rank zero has one incoming edge. For each transition, the first source owns `ceil(0.8 * target rank width)` target edges; remaining targets are distributed over the other sources. Implemented by `builders/unbalanced-scenario.ts`.

```mermaid
flowchart LR
    subgraph r0["rank 0 (width 1)"]
        n0["node 0"]
    end
    subgraph r1["rank 1 (width 3)"]
        n1["node 1: dominant"]
        n2["node 2"]
        n3["node 3"]
    end
    subgraph r2["rank 2 (width 5)"]
        n4["node 4"]
        n5["node 5"]
        n6["node 6"]
        n7["node 7"]
        n8["node 8"]
    end
    n0 --> n1 & n2 & n3
    n1 -->|"4 of 5"| n4 & n5 & n6 & n7
    n2 --> n8
    n8 --> more["*"]
```

The `4 of 5` label illustrates the dominant source's 80% share. `*` continues with wider square-shell ranks; it does not add another edge to the illustrated rank transition.

## unbalanced-random

Ranks and edge density match `unbalanced`, but a local integer PRNG with exported fixed seed chooses the dominant source independently for each transition. Metadata records the selected owner IDs. `Math.random()` is never used. Implemented by `builders/unbalanced-random-scenario.ts`.

```mermaid
flowchart LR
    r0["rank 0"] --> r1["rank 1"]
    r1 -->|"owner: node 1"| r2["rank 2"]
    r2 -->|"owner: node 6"| more["*"]
```

Rank 0 contains node 0, rank 1 contains nodes 1-3, and rank 2 contains nodes 4-8. The fixed seed selects node 1 to own 4 of the 5 edges into rank 2, then selects node 6 for the next transition. `*` continues the same seeded selection over wider ranks.

## subgroups

Node indices divisible by ten remain at root. All other nodes alternate between two top-level groups and use binary-tree edges. This leaves `ceil(0.1 * nodeCount)` root nodes and keeps either group at or below half of all requested nodes. Implemented by `builders/subgroups-scenario.ts`.

```mermaid
flowchart TB
    n0["node 0<br/>root"] --> a1["node 1<br/>group A"] & b2["node 2<br/>group B"]
    a1 --> a3["node 3<br/>group A"] & b4["node 4<br/>group B"]
    b2 --> a5["node 5<br/>group A"] & b6["node 6<br/>group B"]
    b6 --> pattern["*"]
```

`*` continues the binary-tree edges. Non-multiples of ten keep alternating between groups A and B; nodes 10, 20, and later multiples of ten remain at the document root.

## nested-subgroups

Nodes use long-queue edges. Node `i` belongs directly to group `i`; group `i > 0` belongs to group `i - 1`. Containment depth therefore grows with node count. Implemented by `builders/nested-subgroups-scenario.ts`.

```mermaid
flowchart LR
    g0["group 0"] -->|"contains"| g1["group 1"] -->|"contains"| g2["group 2"] -->|"contains"| more["*"]
    g0 -->|"direct member"| n0["node 0"]
    g1 -->|"direct member"| n1["node 1"]
    g2 -->|"direct member"| n2["node 2"]
    n0 -->|"queue edge"| n1 -->|"queue edge"| n2
```

`*` continues both chains: each next group is nested in its predecessor, and its same-index node is a direct member connected by the long-queue edge.

## wide-bipartite-layers

Nodes use append-only square-shell ranks `floor(sqrt(i))`. Every source in rank `r` connects to every target in rank `r + 1`, producing dense adjacent-rank routing with near-`O(n^(3/2))` edge growth. Implemented by `builders/wide-bipartite-layers-scenario.ts`.

```mermaid
flowchart LR
    subgraph r1["rank 1: nodes 1...3"]
        n1["node 1"]
        n2["node 2"]
        n3["node 3"]
    end
    subgraph r2["rank 2: nodes 4...8"]
        n4["node 4"]
        n5["node 5"]
        more["*"]
    end
    n1 --> n4 & n5 & more
    n2 --> n4 & n5 & more
    n3 --> n4 & n5 & more
```

Within rank 2, `*` represents nodes 6-8. Each displayed source connects to every target represented in that rank; subsequent adjacent ranks follow the same complete bipartite rule.

## repeated-diamonds

Consecutive `source -> {left, right} -> merge` motifs share each merge as the next source. A final motif may be truncated to preserve the exact requested node count. Implemented by `builders/repeated-diamonds-scenario.ts`.

```mermaid
flowchart LR
    s0["source 0"] --> l1["left 1"] & r2["right 2"]
    l1 --> m3["merge 3"]
    r2 --> m3
    m3 --> l4["left 4"] & r5["right 5"]
    l4 --> m6["merge 6"]
    r5 --> m6
    m6 --> more["*"]
```

`*` starts the next fan-out/fan-in motif from merge node 6; the final motif may stop early at the requested node count.

## disconnected-components

Nodes are partitioned into deterministic two-node chains. An odd count leaves the final node isolated. Implemented by `builders/disconnected-components-scenario.ts`.

```mermaid
flowchart LR
    n0["node 0"] --> n1["node 1"]
    n2["node 2"] --> n3["node 3"]
    n4["node 4"] --> n5["node 5"]
    isolated["*"]
```

`*` denotes the final isolated node when the requested count is odd. Otherwise, every component is a two-node chain like those shown.

## junction-heavy

One XOR junction is inserted between every adjacent pair in a semantic-node chain. Relations alternate `node -> junction -> node`. Current production ranking increments on every edge, so junctions occupy odd ranks and semantic node `i` occupies graph rank `2 * i`; zero rank increment into junctions is a future production change. Implemented by `builders/junction-heavy-scenario.ts`.

```mermaid
flowchart LR
    n0["node 0<br/>rank 0"] --> j0{{"XOR 0<br/>rank 1"}} --> n1["node 1<br/>rank 2"] --> j1{{"XOR 1<br/>rank 3"}} --> n2["node 2<br/>rank 4"] --> more["*"]
```

`*` continues the alternating node/XOR chain. The diagram shows current production behavior: both edges around each XOR advance rank. The future zero-increment rule for edges entering junctions is not depicted.

## group-relations

Node `i` belongs to sibling group `floor(sqrt(i))`, yielding prefix-stable group widths `1, 3, 5, ...`. One semantic relation connects each populated group to the next. Current production graph creation ranks those group endpoints directly and leaves their member nodes at rank zero; descendant Cartesian expansion is a future production change. Implemented by `builders/group-relations-scenario.ts`.

```mermaid
flowchart LR
    g0["group 0<br/>rank 0"] -->|"direct relation"| g1["group 1<br/>rank 1"]
    g1 -->|"direct relation"| g2["group 2<br/>rank 2"]
    g2 --> more["*"]
    g0 -->|"contains"| n0["node 0<br/>rank 0"]
    g1 -->|"contains"| n1["nodes 1-3<br/>rank 0"]
    g2 -->|"contains"| n4["nodes 4-8<br/>rank 0"]
```

The group widths are 1, 3, 5, then 7, 9, and so on; `*` continues that sibling-group sequence. Only the direct group-to-group arrows exist in the current ranking graph. The containment arrows describe document membership, not ranking adjacency: all member nodes remain at rank zero. Member-to-member Cartesian edges are future production work and are intentionally not depicted.

## shallow-groups

Nodes use binary-tree edges. Indices divisible by ten stay at root; all other nodes enter append-only sibling groups containing at most nine direct nodes, with no nesting. This isolates group count and envelope scans from containment depth. Implemented by `builders/shallow-groups-scenario.ts`.

```mermaid
flowchart TB
    n0["node 0<br/>root"] --> n1["node 1<br/>group 0"] & n2["node 2<br/>group 0"]
    n1 --> n3["node 3<br/>group 0"] & n4["node 4<br/>group 0"]
    n4 --> more["*"]
```

`*` continues the binary-tree edges. Node 10 remains at the document root, nodes 11-19 enter group 1, and later blocks follow the same pattern. Every group is a sibling with at most nine direct nodes; groups never nest.

## Governance

Changing a topology requires updating this README, its concrete builder, and its focused contract test together. Adding a topology requires a tuple member, one implementation, one catalog entry, one README heading, and focused assertions.

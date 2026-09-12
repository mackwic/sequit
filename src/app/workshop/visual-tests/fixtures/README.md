# Visual graph fixtures

`VisualGraphBuilder` prepares node dimensions and document relations. `build()` returns data
accepted by `layoutNodes`, which still runs the real graph, rank and layout pipeline.
The builder does not compute expected ranks, coordinates or assertions.

```ts
const graph = graphFixtures.threeSuccessors().withIsolatedNode('e').build();
const layout = await layoutNodes({ direction, bias, ...graph });
```

Named fixtures use explicit 100 × 60 node dimensions. Each factory call creates a fresh mutable
builder. Chained methods extend that builder; every `build()` produces an independent snapshot.
Use a new factory call for an independent variant.

For a custom topology or different dimensions:

```ts
const graph = new VisualGraphBuilder({ width: 100, height: 60 })
	.nodes(['a'])
	.nodes(['b'], { width: 200, height: 120 })
	.successorsOf('a', ['b'])
	.build();
```

`successorsOf('a', ['b'])` creates the document arrow **B → A** with the historical ID
`a-to-b`. Logical succession and arrow direction are different concepts in these scenarios.
Use `relation({ id, from, to })` for an explicit document arrow.

The builder rejects duplicate or blank IDs, invalid dimensions and missing relation endpoints.
Relations may be declared before their nodes; endpoint validation happens at `build()`.
Cycle detection stays in the real graph pipeline. Assertions stay in each `.scenario.ts` file,
independent of fixture construction.

All node scenarios use these fixtures. Reuse a named base and keep small extensions visible in
`arrange`, for example a descendant added to one branch:

```ts
const graph = graphFixtures.twoSuccessors().nodes(['d']).successorsOf('b', ['d']).build();
```

`independentNodes(ids)` supplies the standard dimensions for custom topologies. Add nodes with
explicit dimensions for size-sensitive scenarios. Keep node and relation insertion order stable:
it is part of the input to the layout pipeline.

Routing scenarios also use `VisualGraphBuilder`, through `routingLayout`. That helper preserves
content dimensions along the transverse axis and uses `relation` for explicit document arrows.
Comparative scenarios build their reference and variant separately. Assertions and routing
policies remain independent of graph construction.

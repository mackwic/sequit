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

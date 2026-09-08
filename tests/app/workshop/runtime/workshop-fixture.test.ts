import { expect, it } from 'vitest';

import { AI_DOCUMENTARY_EFFORT_SOURCE } from '../../../../src/app/web/examples/example-document';
import { LAYOUT_PERFORMANCE_NODE_COUNTS } from '../../../../src/app/workshop/fixtures/layout-performance/node-counts';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../../../../src/app/workshop/fixtures/layout-performance/scenarios';
import { loadWorkshopFixture } from '../../../../src/app/workshop/runtime/workshop-fixture';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';

it('uses the default document for missing, unknown or unbounded fixture requests', () => {
	for (const query of [
		'',
		'fixture=unknown&nodes=10',
		'fixture=long-queue',
		'fixture=long-queue&nodes=0',
		'fixture=long-queue&nodes=1000000',
		'nodes=10',
	]) {
		expect(loadWorkshopFixture(new URLSearchParams(query))).toMatchObject({
			id: 'simple',
			kind: 'example',
			nodeCount: 3,
			relations: 2,
		});
	}
});

for (const scenario of LAYOUT_PERFORMANCE_SCENARIOS) {
	it.each(LAYOUT_PERFORMANCE_NODE_COUNTS)(
		`${scenario.name}: shares the exact %i-node benchmark document through TOML`,
		(nodes) => {
			const fixture = loadWorkshopFixture(
				new URLSearchParams({ fixture: scenario.name, nodes: String(nodes) }),
			);
			expect(fixture).not.toBeNull();
			if (!fixture) throw new Error('Missing fixture');
			const expected = scenario.createBuilder().buildSnapshot(nodes).document;
			expect(fixture.source).toBe(serializeSequitToml(expected));
			const parsed = parseSequitToml(fixture.source);
			if (!parsed.ok) throw new Error('Invalid fixture TOML');
			const graph = createGraph(parsed.value);
			if (graph.ok) expect(fixture.problem).toBe('');
			else expect(fixture.problem).toBe(graph.diagnostics.map(({ message }) => message).join('; '));
			expect(serializeSequitToml(parsed.value)).toBe(fixture.source);
			expect(parsed.value.nodes).toHaveLength(nodes);
			expect(fixture).toMatchObject({
				nodeCount: nodes,
				groups: expected.groups.length,
				junctions: expected.junctions.length,
				relations: expected.relations.length,
			});
		},
		20000,
	);
}

it('uses the actual homepage source and keeps guided fixtures explicitly selectable', () => {
	const varied = loadWorkshopFixture(new URLSearchParams('fixture=varied&nodes=1000'));
	expect(varied).toMatchObject({
		id: 'varied',
		kind: 'example',
		source: AI_DOCUMENTARY_EFFORT_SOURCE,
		problem: '',
	});
	expect(varied?.nodeCount).toBeGreaterThan(3);
	expect(loadWorkshopFixture(new URLSearchParams('fixture=simple'))).toMatchObject({
		id: 'simple',
		nodeCount: 3,
	});
	expect(loadWorkshopFixture(new URLSearchParams('fixture=parcours'))).toBeNull();
});

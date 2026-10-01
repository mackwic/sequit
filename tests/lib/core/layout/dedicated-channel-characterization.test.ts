import { describe, expect, it } from 'vitest';

import { WideBipartiteLayersScenarioBuilder } from '../../../../src/app/workshop/fixtures/layout-performance/builders/wide-bipartite-layers-scenario';
import {
	EndpointKind,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import {
	junctionNetworkDocument,
	multirankOne,
	multirankTwo,
	railReuseDocument,
} from '../../../support/scenarios/dedicated-channel-witnesses';
import { referenceRouteBridgeAnalysis } from './bridge-oracle-reference';

function visibleRoutes(document: LogicDocument) {
	const created = createGraph(document);
	if (!created.ok) throw new Error(`Invalid channel witness ${document.id}`);
	const layout = layoutWithDedicatedEngine(
		created.value,
		topologicallyRank(created.value),
		layoutMeasurementsFor(document),
	);
	return new Map(layout.relations.map((relation) => [relation.id, relation.points]));
}

describe('observable dedicated channel routes', () => {
	it('reuses a visible rail for separated routes and keeps parallel junction relations distinct', () => {
		const routes = visibleRoutes(railReuseDocument());
		const first = routes.get('c-to-e');
		const second = routes.get('d-to-e');
		if (first === undefined || second === undefined) throw new Error('Expected rail reuse routes');
		expect(first[3]?.y).toBe(second[3]?.y);
		expect(first[3]?.x).not.toBe(second[3]?.x);
		const junctions = visibleRoutes(junctionNetworkDocument('junction-network'));
		expect(junctions.get('j-to-d-one')).not.toEqual(junctions.get('j-to-d-two'));
	});

	it.each([
		[multirankOne, ['a-to-d', 'b-to-c']],
		[multirankTwo, ['c-to-f', 'd-to-e']],
	] as const)('avoids the formerly crossed pair in %s', (document, pair) => {
		const routes = visibleRoutes(document);
		const paths = pair.map((id) => ({ id, points: routes.get(id) ?? [] }));
		expect(paths.every(({ points }) => points.length > 1)).toBe(true);
		expect(referenceRouteBridgeAnalysis(paths).crossings).toEqual([]);
	});
});

const familyCases = [
	{
		id: 'k33',
		ids: ['x', 'y', 'z', 'a', 'b', 'c'],
		pairs: ['x', 'y', 'z'].flatMap((from) => ['a', 'b', 'c'].map((to) => [from, to] as const)),
		crossings: 9,
	},
	{
		id: 'k23',
		ids: ['k0', 'k1', 'r0', 'r1', 'r2'],
		pairs: [
			['k0', 'r1'],
			['k0', 'r2'],
			['k1', 'r0'],
			['k1', 'r1'],
			['k1', 'r2'],
		],
		crossings: 1,
	},
	{
		id: 'm5-13',
		ids: ['a', 'b', 'c', 'd', 'e'],
		pairs: [
			['c', 'a'],
			['d', 'a'],
			['d', 'b'],
			['e', 'a'],
			['e', 'b'],
		],
		crossings: 1,
	},
] as const;

describe.each(Object.values(LayoutDirection))('nested endpoint families in %s', (direction) => {
	it('splits the column cycle closed by endpoint nesting in the fifteenth dense insertion', () => {
		const snapshot = new WideBipartiteLayersScenarioBuilder().buildSnapshot(15).document;
		const configuration = LAYOUT_CONFIGURATIONS.find(
			(candidate) => candidate.direction === direction,
		);
		if (configuration === undefined) throw new Error('Missing layout direction configuration');
		const document = { ...snapshot, layout: configuration };
		const routes = visibleRoutes(document);
		const paths = document.relations.map((relation) => ({
			...relation,
			points: routes.get(relation.id) ?? [],
		}));
		for (const field of ['from', 'to'] as const) {
			for (const endpoint of new Set(paths.map((path) => path[field]))) {
				expect(
					referenceRouteBridgeAnalysis(paths.filter((path) => path[field] === endpoint)).crossings,
				).toEqual([]);
			}
		}
	});

	it.each(familyCases)('removes every family bridge in $id', ({ id, ids, pairs, crossings }) => {
		const configuration = LAYOUT_CONFIGURATIONS.find(
			(candidate) => candidate.direction === direction,
		);
		if (configuration === undefined) throw new Error('Missing layout direction configuration');
		const document: LogicDocument = {
			...multirankOne,
			id,
			title: id,
			groups: [],
			junctions: [],
			layout: configuration,
			nodes: ids.map((nodeId, index) => ({
				kind: EndpointKind.Node,
				id: nodeId,
				natureId: 'task',
				markdown: nodeId,
				layoutOrder: orderKey(`a${index + 1}`),
			})),
			relations: pairs.map(([from, to]) => ({ id: `${from}-to-${to}`, from, to })),
		};
		const routes = visibleRoutes(document);
		const paths = document.relations.map((relation) => ({
			...relation,
			points: routes.get(relation.id) ?? [],
		}));
		expect(referenceRouteBridgeAnalysis(paths).crossings).toHaveLength(crossings);
		for (const field of ['from', 'to'] as const) {
			for (const endpoint of ids) {
				const family = paths.filter((path) => path[field] === endpoint);
				expect(referenceRouteBridgeAnalysis(family).crossings).toEqual([]);
			}
		}
	});
});

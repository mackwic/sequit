import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridge-oracle';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import {
	type LayoutMeasurementOverrides,
	layoutMeasurementsFor,
} from '../../../support/builders/layout-measurements';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

function digest(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function makeDocument(
	id: string,
	ids: readonly string[],
	relations: LogicDocument['relations'],
): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id,
		title: id,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		junctions: [],
		nodes: ids.map((nodeId, index) => ({
			id: nodeId,
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: nodeId,
			layoutOrder: orderKey(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'][index] ?? 'a6'),
		})),
		relations,
	};
}

function groupedJunction(id: string, relations: LogicDocument['relations']): LogicDocument {
	const base = makeDocument(id, ['a', 'b', 'c', 'd', 'e', 'f'], relations);
	return {
		...base,
		groups: [
			{ kind: EndpointKind.Group, id: 'group', label: 'Group', layoutOrder: orderKey('a0') },
		],
		nodes: base.nodes.map((node) => {
			if (['a', 'b', 'd'].includes(node.id)) return { ...node, groupId: 'group' };
			return node;
		}),
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'join',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a7'),
			},
		],
		relations,
	};
}

const multirankOne = groupedJunction('multirank-group-junction-one', [
	{ id: 'a-to-d', from: 'a', to: 'd' },
	{ id: 'b-to-c', from: 'b', to: 'c' },
	{ id: 'c-to-e', from: 'c', to: 'e' },
	{ id: 'd-to-f', from: 'd', to: 'f' },
	{ id: 'e-to-join', from: 'e', to: 'join' },
	{ id: 'f-to-join', from: 'f', to: 'join' },
]);
const multirankTwo = groupedJunction('multirank-group-junction-two', [
	{ id: 'a-to-c', from: 'a', to: 'c' },
	{ id: 'b-to-d', from: 'b', to: 'd' },
	{ id: 'c-to-f', from: 'c', to: 'f' },
	{ id: 'd-to-e', from: 'd', to: 'e' },
	{ id: 'e-to-join', from: 'e', to: 'join' },
	{ id: 'f-to-join', from: 'f', to: 'join' },
]);
const groupEndpoint: LogicDocument = {
	...multirankOne,
	id: 'group-endpoint-route',
	title: 'group-endpoint-route',
	relations: [...multirankOne.relations, { id: 'group-to-e', from: 'group', to: 'e' }],
};

function railReuseDocument(id: string): LogicDocument {
	const base = makeDocument(
		id,
		['a', 'b', 'c', 'd', 'e'],
		[
			{ id: 'a-to-d', from: 'a', to: 'd' },
			{ id: 'b-to-c', from: 'b', to: 'c' },
			{ id: 'c-to-e', from: 'c', to: 'e' },
			{ id: 'd-to-e', from: 'd', to: 'e' },
			{ id: 'c-to-sink', from: 'c', to: 'sink' },
			{ id: 'd-to-sink', from: 'd', to: 'sink' },
		],
	);
	return {
		...base,
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'sink',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a6'),
			},
		],
	};
}
const railReuse = railReuseDocument('rail-reuse');

const junctionNetwork: LogicDocument = {
	...makeDocument(
		'junction-network-layout',
		['a', 'b', 'c', 'd'],
		[
			{ id: 'j-to-a', from: 'j', to: 'a' },
			{ id: 'j-to-d-one', from: 'j', to: 'd' },
			{ id: 'j-to-d-two', from: 'j', to: 'd' },
			{ id: 'k-to-b', from: 'k', to: 'b' },
			{ id: 'k-to-a', from: 'k', to: 'a' },
			{ id: 'a-to-sink', from: 'a', to: 'sink' },
			{ id: 'b-to-sink', from: 'b', to: 'sink' },
			{ id: 'j-to-sink', from: 'j', to: 'sink' },
			{ id: 'k-to-sink', from: 'k', to: 'sink' },
		],
	),
	junctions: ['j', 'k', 'sink'].map((id, index) => ({
		kind: EndpointKind.Junction as const,
		id,
		operator: JunctionOperator.Xor,
		layoutOrder: orderKey(['a0', 'a1', 'a2'][index] ?? 'a2'),
	})),
};

function assertFiniteLayout(layout: LayoutResult): void {
	const values = [layout.width, layout.height];
	for (const { bounds } of layout.elements)
		values.push(bounds.x, bounds.y, bounds.width, bounds.height);
	for (const { points } of layout.relations) for (const { x, y } of points) values.push(x, y);
	for (const { bounds } of layout.regions ?? [])
		values.push(bounds.x, bounds.y, bounds.width, bounds.height);
	for (const { bounds } of layout.lanes ?? [])
		values.push(bounds.x, bounds.y, bounds.width, bounds.height);
	for (const node of layout.routingInspection?.nodes ?? []) {
		values.push(
			node.content.x,
			node.content.y,
			node.content.width,
			node.content.height,
			node.incomingMinimum,
			node.outgoingMinimum,
		);
		for (const { point } of node.ports) values.push(point.x, point.y);
	}
	for (const corridor of layout.routingInspection?.corridors ?? []) {
		values.push(
			corridor.bounds.x,
			corridor.bounds.y,
			corridor.bounds.width,
			corridor.bounds.height,
			corridor.requiredGap,
		);
		for (const { coordinate } of corridor.rails) values.push(coordinate);
	}
	for (const value of values) expect(Number.isFinite(value)).toBe(true);
}

interface IdentityCase {
	readonly id: string;
	readonly document: LogicDocument;
	readonly measurementOverrides?: LayoutMeasurementOverrides;
}

const rankCases = rankOrderComparisonCorpus()
	.slice(0, 2)
	.map(({ id, document }) => ({ id, document }));
const clearanceDocument = rankCases.find(({ id }) => id === 'adjacent-3+1')?.document;
if (clearanceDocument === undefined) throw new Error('The adjacent 3+1 document must exist');
function clearanceCase(
	id: string,
	widths: readonly number[],
	document: LogicDocument,
): IdentityCase {
	const nodes: Record<string, { width: number; height: number }> = {};
	for (const [index, nodeId] of ['a', 'b', 'c', 'd', 'e'].entries()) {
		const width = widths[index];
		if (width === undefined) throw new Error('Every clearance fixture needs five node widths');
		nodes[nodeId] = { width, height: 116 };
	}
	return { id, document, measurementOverrides: { nodes } };
}
const cases: IdentityCase[] = [
	...rankCases,
	{ id: 'multirank-group-junction-one', document: multirankOne },
	{ id: 'multirank-group-junction-two', document: multirankTwo },
	{ id: 'junction-network-layout', document: junctionNetwork },
	{ id: 'group-endpoint-route', document: groupEndpoint },
	{ id: 'rail-reuse', document: railReuse },
	clearanceCase('rail-clearance-12', [131, 178, 225, 272, 319], clearanceDocument),
	clearanceCase('rail-clearance-13', [129, 176, 223, 270, 317], clearanceDocument),
];

describe('dedicated engine LayoutResult identity', () => {
	it('pins twelve complete layouts and asserts observable geometry by ID', async () => {
		const aiSource = await aiDocumentaryEffortScenario();
		const aiDocument = parseSequitToml(aiSource);
		if (!aiDocument.ok) throw new Error('The AI documentary effort example must parse');
		const workshopCases = await Promise.all(
			['branching', 'navigation'].map(async (name) => {
				const source = await readFile(
					new URL(`../../../../src/app/workshop/${name}.toml`, import.meta.url),
					'utf8',
				);
				const parsed = parseSequitToml(source);
				if (!parsed.ok) throw new Error(`The workshop ${name} fixture must parse`);
				return { id: `workshop-${name}`, document: parsed.value };
			}),
		);
		expect(aiDocument.value.nodes).toHaveLength(24);
		expect(aiDocument.value.groups).toHaveLength(2);
		expect(aiDocument.value.junctions).toHaveLength(1);
		const allCases: IdentityCase[] = [
			...cases,
			{ id: 'ai-documentary-effort', document: aiDocument.value },
			...workshopCases,
		];
		const results = Object.fromEntries(
			allCases.map(({ id, document, measurementOverrides }) => {
				const graphResult = createGraph(document);
				if (!graphResult.ok) throw new Error(`Invalid graph for ${id}`);
				const graph = graphResult.value;
				const ranks = topologicallyRank(graph);
				const measurements = layoutMeasurementsFor(document, measurementOverrides);
				const result = layoutWithDedicatedEngine(graph, ranks, measurements, {
					inspectRouting: true,
				});
				expect(result.routingInspection).toBeDefined();
				assertFiniteLayout(result);
				return [id, result];
			}),
		);
		const hashes = Object.fromEntries(
			Object.entries(results).map(([id, result]) => [id, digest(result)]),
		);
		const expectedIds = allCases.map(({ id }) => id);
		expect(expectedIds).toHaveLength(12);
		expect(new Set(expectedIds).size).toBe(expectedIds.length);
		expect(new Set(Object.values(hashes)).size).toBe(Object.keys(hashes).length);

		expect(hashes).toEqual({
			'adjacent-2+2': '9b431c8e68b8479123f3ccb6e5733142c820a5cf91aa514aac4b481c79fb6e7b',
			'adjacent-3+1': 'fdb0249a5b7112767e038d033b441777f88a535a3d3bc59bc18c0b306338cc4a',
			'ai-documentary-effort': 'efc78b3328e0fd53d68b5e26881580d51cdd98a2ebf24c6dbdd6b0d88cb4f1ee',
			'group-endpoint-route': '839c296963b8d825fb6032e718e720aea867f99f0197fb96cdf159d643eb3014',
			'junction-network-layout': '45f5fe4e060ade9f470997da6b56b1b9aa7caa52dea13feeccb16f97420a5965',
			'multirank-group-junction-one':
				'81c7e3fe345ba85f5d47c64571cfc3b594c795f4f3519c2229ba40e80bf406ec',
			'multirank-group-junction-two':
				'f6d92f4c952bd99cc7d88cfb44b04b055e66548d1b73cb94c5db5e7e3def978d',
			'rail-clearance-12': '9dae568401b9b8462723aa9c5564a2f04c4958fdb90a5ac445f37bbee3a60e9f',
			'rail-clearance-13': '637f35ef14ed710564549725d3f26f676cb4dc0e0357fd675c2b20de6e6db695',
			'rail-reuse': 'bf9eedd9a6eb7669b4b969d292616c8f7367b20b5eb017d6f1aed223c3d52a49',
			'workshop-branching': '007f50ba4f616a515f8c8d08e082536958b139ee39d6ad2cb5ef12236c0e58c4',
			'workshop-navigation': '44bc5d3435f46a72dd2794838daaf7ba425cad1a4b4c551d90747fea8efb1c37',
		});

		const casesById = new Map(allCases.map(({ id, ...identityCase }) => [id, identityCase]));
		for (const [id, result] of Object.entries(results)) {
			const identityCase = casesById.get(id);
			if (identityCase === undefined) throw new Error(`Missing source document for ${id}`);
			const elementsById = new Map(result.elements.map((element) => [element.id, element]));
			for (const endpoint of [
				...identityCase.document.nodes,
				...identityCase.document.groups,
				...identityCase.document.junctions,
			]) {
				const element = elementsById.get(endpoint.id);
				expect(element, `${id} box ${endpoint.id}`).toBeDefined();
				expect(element?.bounds.width).toBeGreaterThan(0);
				expect(element?.bounds.height).toBeGreaterThan(0);
			}
			const routesById = new Map(result.relations.map((route) => [route.id, route]));
			for (const relation of identityCase.document.relations) {
				const route = routesById.get(relation.id);
				expect(route, `${id} route ${relation.id}`).toMatchObject({
					from: relation.from,
					to: relation.to,
				});
				expect(route?.points.length).toBeGreaterThan(1);
			}
		}

		const groupRoute = results['group-endpoint-route']?.relations.find(
			({ id }) => id === 'group-to-e',
		);
		expect(groupRoute).toMatchObject({ from: 'group', to: 'e' });
		expect(groupRoute?.points.length).toBeGreaterThan(2);

		const crossingsByLayout = [
			['multirank-group-junction-one', ['a-to-d', 'b-to-c'] as const],
			['multirank-group-junction-two', ['c-to-f', 'd-to-e'] as const],
		] as const;
		for (const [id, relationIds] of crossingsByLayout) {
			const layout = results[id];
			if (layout === undefined) throw new Error(`Missing LayoutResult ${id}`);
			const crossingBridgeIds = routeBridgeAnalysis(layout.relations).bridges.map(
				({ carrierIds, crossedIds }) => [...new Set([...carrierIds, ...crossedIds])].toSorted(),
			);
			expect(crossingBridgeIds).toContainEqual([...relationIds].toSorted());
		}

		expect(
			results['ai-documentary-effort']?.elements.filter(({ kind }) => kind === EndpointKind.Node),
		).toHaveLength(24);
		expect(
			results['ai-documentary-effort']?.elements.filter(({ kind }) => kind === EndpointKind.Group),
		).toHaveLength(2);
		expect(
			results['ai-documentary-effort']?.elements.filter(
				({ kind }) => kind === EndpointKind.Junction,
			),
		).toHaveLength(1);
		const branching = workshopCases.find(({ id }) => id === 'workshop-branching');
		const navigation = workshopCases.find(({ id }) => id === 'workshop-navigation');
		if (!branching || !navigation) throw new Error('Both workshop scenes must be loaded');
		expect(branching.document.nodes).toHaveLength(4);
		expect(branching.document.relations).toHaveLength(3);
		expect(navigation.document.nodes).toHaveLength(9);
		expect(navigation.document.relations).toHaveLength(8);
		expect(
			results['workshop-branching']?.elements.filter(({ kind }) => kind === EndpointKind.Node),
		).toHaveLength(4);
		expect(
			results['workshop-navigation']?.elements.filter(({ kind }) => kind === EndpointKind.Node),
		).toHaveLength(9);
	});
});

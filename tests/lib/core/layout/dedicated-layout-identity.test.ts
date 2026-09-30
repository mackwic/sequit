import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { rankOrderComparisonCorpus } from '../../../../src/app/workshop/solver-prototype/rank-order-comparison';
import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import {
	evaluateDedicatedLayout,
	layoutWithDedicatedEngine,
	layoutWithDedicatedEngineAndRankOrderWitness,
} from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import {
	type LayoutMeasurementOverrides,
	layoutMeasurementsFor,
} from '../../../support/builders/layout-measurements';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';
import {
	groupedJunction,
	junctionNetworkDocument,
	multirankOne,
	multirankTwo,
	railClearanceDocument,
	railClearanceMeasurements,
	railReuseDocument,
} from '../../../support/scenarios/dedicated-channel-witnesses';

function digest(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isDescendantOfGroup(
	document: LogicDocument,
	node: LogicDocument['nodes'][number],
	groupId: string,
): boolean {
	const groups = new Map(document.groups.map((group) => [group.id, group]));
	let parentId = node.groupId;
	while (parentId !== undefined) {
		if (parentId === groupId) return true;
		parentId = groups.get(parentId)?.groupId;
	}
	return false;
}

function intersects(
	left: LayoutResult['elements'][number]['bounds'],
	right: LayoutResult['elements'][number]['bounds'],
): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
}

const groupEndpoint: LogicDocument = {
	...multirankOne,
	id: 'group-endpoint-route',
	title: 'group-endpoint-route',
	relations: [...multirankOne.relations, { id: 'group-to-e', from: 'group', to: 'e' }],
};

const junctionNetwork = junctionNetworkDocument('junction-network-layout');

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
const cases: IdentityCase[] = [
	...rankCases,
	{ id: 'multirank-group-junction-one', document: multirankOne },
	{ id: 'multirank-group-junction-two', document: multirankTwo },
	{ id: 'junction-network-layout', document: junctionNetwork },
	{ id: 'group-endpoint-route', document: groupEndpoint },
	{ id: 'rail-reuse', document: railReuseDocument() },
	{
		id: 'rail-clearance-12',
		document: railClearanceDocument(),
		measurementOverrides: railClearanceMeasurements(12),
	},
	{
		id: 'rail-clearance-13',
		document: railClearanceDocument(),
		measurementOverrides: railClearanceMeasurements(13),
	},
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
		const validationById = new Map<string, ReturnType<typeof validateDedicatedCandidate>>();
		const results = Object.fromEntries(
			allCases.map(({ id, document, measurementOverrides }) => {
				const graphResult = createGraph(document);
				if (!graphResult.ok) throw new Error(`Invalid graph for ${id}`);
				const graph = graphResult.value;
				const ranks = topologicallyRank(graph);
				const measurements = layoutMeasurementsFor(document, measurementOverrides);
				const selected = layoutWithDedicatedEngineAndRankOrderWitness(graph, ranks, measurements, {
					inspectRouting: true,
				});
				const result = selected.layout;
				if (id.startsWith('rail-clearance-')) expect(selected.witness.evaluated).toBe(1);
				if (id.startsWith('rail-clearance-')) expect(selected.witness.stop).toBe('shape-envelope');
				validationById.set(
					id,
					validateDedicatedCandidate({ graph, ranks, measurements, layout: result }),
				);

				expect(result.routingInspection).toBeDefined();
				assertFiniteLayout(result);
				return [id, result];
			}),
		);

		const expectedAcceptedIds = [
			'adjacent-2+2',
			'adjacent-3+1',
			'ai-documentary-effort',
			'group-endpoint-route',
			'junction-network-layout',
			'multirank-group-junction-one',
			'multirank-group-junction-two',
			'rail-clearance-12',
			'rail-clearance-13',
			'rail-reuse',
			'workshop-branching',
			'workshop-navigation',
		];
		expect(
			[...validationById]
				.filter(([, validation]) => validation.valid)
				.map(([id]) => id)
				.toSorted(),
		).toEqual(expectedAcceptedIds.toSorted());

		const hashes = Object.fromEntries(
			Object.entries(results).map(([id, result]) => [id, digest(result)]),
		);

		for (const id of [
			'multirank-group-junction-one',
			'multirank-group-junction-two',
			'group-endpoint-route',
		]) {
			const document = allCases.find((candidate) => candidate.id === id)?.document;
			const result = results[id];
			if (document === undefined || result === undefined)
				throw new Error(`Missing grouped identity case ${id}`);
			const elements = new Map(result.elements.map((element) => [element.id, element]));
			for (const group of document.groups) {
				const groupBounds = elements.get(group.id)?.bounds;
				if (groupBounds === undefined) throw new Error(`Missing group bounds ${group.id}`);
				for (const node of document.nodes) {
					if (isDescendantOfGroup(document, node, group.id)) continue;
					const nodeBounds = elements.get(node.id)?.bounds;
					if (nodeBounds === undefined) throw new Error(`Missing node bounds ${node.id}`);
					expect(
						intersects(groupBounds, nodeBounds),
						`${id}: non-descendant node ${node.id} must stay outside group ${group.id}`,
					).toBe(false);
				}
			}
		}
		const expectedIds = allCases.map(({ id }) => id);
		expect(expectedIds).toHaveLength(12);
		expect(new Set(expectedIds).size).toBe(expectedIds.length);
		expect(new Set(Object.values(hashes)).size).toBe(Object.keys(hashes).length);

		expect(hashes).toEqual({
			'adjacent-2+2': '434436502a19e68bbaf5e254e6dd74a1d97387393caeadfc4f70099b2c091c19',
			'adjacent-3+1': '064082e2065ad7f76e35849ee4e1c402e721cd164b5e4966e4d88d7868f9fd6d',
			'ai-documentary-effort': '23810c7b50f523acaedd01c6574ef9bb95527d63cd8d902cb0b6c436d3a9e54f',
			'group-endpoint-route': '7b98d8fbdad2470412e90f91c2383223d3c170e92f5111ecc8cf64bcc2b011ea',
			'junction-network-layout': '5732e699fa828404b120005432cd8ce7d706ad33dfe862db6037cd1852895f50',
			'multirank-group-junction-one':
				'5f724cce9f64ea07e1583cd51749855780de1fc81300a19a178b64c4cf50af74',
			'multirank-group-junction-two':
				'e9fedac15be5248ec258d801a1c377855addb6d0cb056aa656856fa2a6e1cab5',
			'rail-clearance-12': 'f90c67014082ac6e2fc0a289abe8c6687d205f7d4143b9dd4080074a74143208',
			'rail-clearance-13': '1bbafa53570b8784c8fc6e7bc2bbd0f3a9f16351d7558c4a4c2efb63e0e40943',
			'rail-reuse': 'c29117ffc17d3aa0da68e71bc498c1c0fff892ee228ed9f55e7f60a9b5f8cc9e',
			'workshop-branching': '007f50ba4f616a515f8c8d08e082536958b139ee39d6ad2cb5ef12236c0e58c4',
			// Re-pinned: block exchanges between channel tracks take its routes from 2 strict
			// crossings and 2 bridges to none.
			'workshop-navigation': 'c5607f4660c584babb37d41073e6866311836b42a646be2a012db3e8be4bef97',
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

		// The group block takes the slot of its first member, a, so its member d precedes c in the
		// documentary rows: the crossing the search must remove involves another pair of relations.
		const crossingsByLayout = [
			['multirank-group-junction-one', ['c-to-e', 'd-to-f'] as const],
			['multirank-group-junction-two', ['a-to-c', 'b-to-d'] as const],
		] as const;
		for (const [id, relationIds] of crossingsByLayout) {
			const selected = results[id];
			const source = allCases.find((candidate) => candidate.id === id);
			if (selected === undefined || source === undefined)
				throw new Error(`Missing LayoutResult ${id}`);
			const created = createGraph(source.document);
			if (!created.ok) throw new Error(`Invalid grouped crossing ${id}`);
			const ranks = topologicallyRank(created.value);
			const documentary = evaluateDedicatedLayout(
				prepareLayout(created.value, ranks),
				layoutMeasurementsFor(source.document, source.measurementOverrides),
				{ inspectRouting: true },
			);
			const pairIds: readonly string[] = relationIds;
			const firstRelation = source.document.relations.find(({ id: relationId }) =>
				pairIds.includes(relationId),
			);
			if (firstRelation === undefined) throw new Error(`Missing documentary crossing in ${id}`);
			const firstRoute = documentary.relations.find(
				({ id: relationId }) => relationId === firstRelation.id,
			);
			const attachment = firstRoute?.points[0];
			if (attachment === undefined) throw new Error(`Missing documentary attachment in ${id}`);
			const inspectedSource = documentary.routingInspection?.nodes.find(
				({ id: endpointId }) => endpointId === firstRelation.from,
			);
			expect(
				inspectedSource?.ports.some(
					({ point, relations }) =>
						relations.includes(firstRelation.id) &&
						point.x === attachment.x &&
						point.y === attachment.y,
				),
			).toBe(true);
			const bridgePairs = (layout: LayoutResult) =>
				routeBridgeAnalysis(layout.relations).bridges.map(({ carrierIds, crossedIds }) =>
					[...new Set([...carrierIds, ...crossedIds])].toSorted(),
				);
			expect(bridgePairs(documentary)).toContainEqual([...relationIds].toSorted());
			expect(bridgePairs(selected)).not.toContainEqual([...relationIds].toSorted());
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
	it('keeps foreign group shells clear of crossing rails in every direction', () => {
		const configurations: LogicDocument['layout'][] = [
			{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
			{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
			{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Left },
		];
		for (const configuration of configurations) {
			const document = { ...multirankTwo, layout: configuration };
			const graphResult = createGraph(document);
			if (!graphResult.ok) throw new Error('The grouped graph must be valid');
			const graph = graphResult.value;
			const ranks = topologicallyRank(graph);
			const measurements = layoutMeasurementsFor(document);
			const layout = layoutWithDedicatedEngine(graph, ranks, measurements);
			expect(
				validateDedicatedCandidate({ graph, ranks, measurements, layout }),
				configuration.direction,
			).toMatchObject({ valid: true });
		}
	});
	it('allows a crossing rail to enter its target group without making it an obstacle', () => {
		const document = groupedJunction('target-group-shell', multirankTwo.relations, ['f']);
		const graphResult = createGraph(document);
		if (!graphResult.ok) throw new Error('The grouped graph must be valid');
		const graph = graphResult.value;
		const ranks = topologicallyRank(graph);
		const measurements = layoutMeasurementsFor(document);
		const layout = layoutWithDedicatedEngine(graph, ranks, measurements);
		expect(validateDedicatedCandidate({ graph, ranks, measurements, layout })).toMatchObject({
			valid: true,
		});
	});
});

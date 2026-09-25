import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

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
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridge-oracle';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { countRankOrderCrossings } from '../../../../src/lib/core/layout/rank-order';
import type * as ChannelRoutingModule from '../../../../src/lib/core/layout/routing/channel-routing';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import type {
	ChannelEndpoint,
	ChannelRouting,
} from '../../../../src/lib/core/layout/routing/channel-types';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import type { LayoutMeasurementOverrides } from '../../../support/builders/layout-measurements';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

const channelObservations = vi.hoisted(() => ({ calls: [] as ChannelObservation[] }));
interface ChannelObservation {
	readonly endpoints: readonly ChannelEndpoint[];
	readonly routing: ChannelRouting;
}
vi.mock('../../../../src/lib/core/layout/routing/channel-routing', async (importOriginal) => {
	const actual = await importOriginal<typeof ChannelRoutingModule>();
	return {
		...actual,
		routeOwnedChannel: (wires: Parameters<typeof actual.routeOwnedChannel>[0]) => {
			const routing = actual.routeOwnedChannel(wires);
			channelObservations.calls.push({ endpoints: wires, routing });
			return routing;
		},
		routeChannel: (endpoints: Parameters<typeof actual.routeChannel>[0]) => {
			const routing = actual.routeChannel(endpoints);
			channelObservations.calls.push({ endpoints, routing });
			return routing;
		},
	};
});

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
const groupEndpoint = {
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

const junctionChannelFamilies: LogicDocument = {
	...makeDocument(
		'junction-channel-families',
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
	nodes: makeDocument('junction-channel-families', ['a', 'b', 'c', 'd'], []).nodes,
	junctions: ['j', 'k', 'sink'].map((id, index) => ({
		kind: EndpointKind.Junction as const,
		id,
		operator: JunctionOperator.Xor,
		layoutOrder: orderKey(['a0', 'a1', 'a2'][index] ?? 'a2'),
	})),
};

function assertFiniteLayout(layout: ReturnType<typeof layoutWithDedicatedEngine>): void {
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

function channelFor(
	channels: ReadonlyMap<string, readonly ChannelObservation[]>,
	id: string,
	relationIds: readonly string[],
): ChannelObservation {
	const channel = (channels.get(id) ?? []).find(({ endpoints }) =>
		relationIds.every((relationId) =>
			endpoints.some(({ id: endpointId }) => endpointId === relationId),
		),
	);
	if (channel === undefined)
		throw new Error(`Missing production channel for ${id}: ${relationIds.join(', ')}`);
	return channel;
}

function wireFor(channel: ChannelObservation, id: string) {
	const wire = channel.routing.wires.find((candidate) => candidate.id === id);
	if (wire === undefined) throw new Error(`Missing production wire ${id}`);
	return wire;
}

function placedBand(
	layout: ReturnType<typeof layoutWithDedicatedEngine>,
	ranks: ReadonlyMap<string, number>,
	rank: number,
): string[] {
	return layout.elements
		.filter(({ id }) => ranks.get(id) === rank)
		.toSorted((left, right) => left.bounds.x - right.bounds.x)
		.map(({ id }) => id);
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
	{ id: 'junction-channel-families', document: junctionChannelFamilies },
	{ id: 'group-endpoint-route', document: groupEndpoint },
	{ id: 'rail-reuse', document: railReuse },
	clearanceCase('rail-clearance-12', [131, 178, 225, 272, 319], clearanceDocument),
	clearanceCase('rail-clearance-13', [129, 176, 223, 270, 317], clearanceDocument),
];

describe('dedicated engine LayoutResult identity', () => {
	it('pins full layouts and proves observed production channel behavior', async () => {
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
		const channels = new Map<string, readonly ChannelObservation[]>();
		const preparedById = new Map<string, ReturnType<typeof prepareLayoutDocument>>();
		const results = Object.fromEntries(
			allCases.map(({ id, document, measurementOverrides }) => {
				const prepared = prepareLayoutDocument(document, measurementOverrides);
				preparedById.set(id, prepared);
				channelObservations.calls.length = 0;
				const result = layoutWithDedicatedEngine(
					prepared.graph,
					prepared.ranks,
					prepared.measurements,
					{ inspectRouting: true },
				);
				channels.set(id, [...channelObservations.calls]);
				expect(result.routingInspection).toBeDefined();
				assertFiniteLayout(result);
				return [id, result];
			}),
		);
		const hashes = Object.fromEntries(
			Object.entries(results).map(([id, result]) => [id, digest(result)]),
		);
		const expectedIds = allCases.map(({ id }) => id);
		expect(new Set(expectedIds).size).toBe(expectedIds.length);
		expect(new Set(Object.values(hashes)).size).toBe(Object.keys(hashes).length);

		expect(hashes).toEqual({
			'adjacent-2+2': '9b431c8e68b8479123f3ccb6e5733142c820a5cf91aa514aac4b481c79fb6e7b',
			'adjacent-3+1': 'fdb0249a5b7112767e038d033b441777f88a535a3d3bc59bc18c0b306338cc4a',
			'ai-documentary-effort': 'efc78b3328e0fd53d68b5e26881580d51cdd98a2ebf24c6dbdd6b0d88cb4f1ee',
			'group-endpoint-route': '839c296963b8d825fb6032e718e720aea867f99f0197fb96cdf159d643eb3014',
			'junction-channel-families':
				'45f5fe4e060ade9f470997da6b56b1b9aa7caa52dea13feeccb16f97420a5965',
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

		expect(
			results['junction-channel-families']?.elements.some(
				({ id, kind }) => id === 'sink' && kind === EndpointKind.Junction,
			),
		).toBe(true);
		const groupRoute = results['group-endpoint-route']?.relations.find(
			({ id }) => id === 'group-to-e',
		);
		expect(groupRoute).toMatchObject({ from: 'group', to: 'e' });
		expect(groupRoute?.points.length).toBeGreaterThan(2);

		const familyCalls = channels.get('junction-channel-families') ?? [];
		const coincidentCalls = familyCalls.filter(({ endpoints }) =>
			endpoints.some(({ source, target }) => source === target),
		);
		expect(coincidentCalls.length).toBeGreaterThan(0);
		const unsharedCoincident = coincidentCalls.flatMap(({ endpoints, routing }) =>
			endpoints
				.filter(
					({ source, target, sharedSource, sharedTarget }) =>
						source === target && sharedSource === undefined && sharedTarget === undefined,
				)
				.map(({ id }) => routing.wires.find((wire) => wire.id === id)),
		);
		expect(
			unsharedCoincident.some((wire) => wire?.first === undefined && wire?.last === undefined),
		).toBe(true);

		const departureFamily = channelFor(channels, 'junction-channel-families', [
			'j-to-a',
			'j-to-d-one',
			'j-to-d-two',
			'j-to-sink',
			'k-to-a',
			'k-to-b',
			'k-to-sink',
		]);
		for (const id of ['j-to-sink', 'k-to-sink']) {
			const endpoint = departureFamily.endpoints.find((candidate) => candidate.id === id);
			expect(endpoint?.sharedSource).toBeDefined();
			expect(endpoint?.sharedTarget).toBe('sink');
		}
		const jDeparture = wireFor(departureFamily, 'j-to-a').first;
		expect(jDeparture).toBeDefined();
		if (jDeparture === undefined) throw new Error('The j departure family must be routed');
		for (const id of ['j-to-d-one', 'j-to-d-two'])
			expect(wireFor(departureFamily, id).first).toBe(jDeparture);
		expect(wireFor(departureFamily, 'j-to-sink').first).not.toBe(jDeparture);

		const arrivalFamily = channelFor(channels, 'junction-channel-families', [
			'a-to-sink',
			'b-to-sink',
			'j-to-sink',
			'k-to-sink',
		]);
		const sharedArrival = wireFor(arrivalFamily, 'a-to-sink').last;
		expect(sharedArrival).toBeDefined();
		if (sharedArrival === undefined) throw new Error('The arrival family must be routed');
		for (const id of ['b-to-sink', 'j-to-sink', 'k-to-sink'])
			expect(wireFor(arrivalFamily, id).last).toBe(sharedArrival);

		for (const id of ['multirank-group-junction-one', 'multirank-group-junction-two']) {
			const layout = results[id];
			const prepared = preparedById.get(id);
			expect(layout).toBeDefined();
			expect(prepared).toBeDefined();
			if (!layout || !prepared) throw new Error(`Missing layout fixture ${id}`);
			expect(layout.elements.some(({ kind }) => kind === EndpointKind.Group)).toBe(true);
			expect(
				layout.elements.some(
					({ id: elementId, kind }) => elementId === 'join' && kind === EndpointKind.Junction,
				),
			).toBe(true);
			expect(Math.max(...prepared.ranks.byEndpointId.values())).toBeGreaterThan(
				Math.min(...prepared.ranks.byEndpointId.values()),
			);

			let sourceIds: readonly string[];
			let targetIds: readonly string[];
			let crossingRelationIds: readonly [string, string];
			let splitId: string;
			let otherId: string;
			if (id === 'multirank-group-junction-one') {
				sourceIds = ['a', 'b'];
				targetIds = ['c', 'd'];
				crossingRelationIds = ['a-to-d', 'b-to-c'];
				splitId = 'a-to-d';
				otherId = 'b-to-c';
			} else {
				sourceIds = ['c', 'd'];
				targetIds = ['e', 'f'];
				crossingRelationIds = ['c-to-f', 'd-to-e'];
				splitId = 'c-to-f';
				otherId = 'd-to-e';
			}
			const sourceRank = prepared.ranks.byEndpointId.get(sourceIds[0] ?? '');
			const targetRank = prepared.ranks.byEndpointId.get(targetIds[0] ?? '');
			if (sourceRank === undefined || targetRank === undefined)
				throw new Error(`Missing witness ranks for ${id}`);
			const placedOrder = [
				placedBand(layout, prepared.ranks.byEndpointId, sourceRank),
				placedBand(layout, prepared.ranks.byEndpointId, targetRank),
			];
			expect(placedOrder).toEqual([sourceIds, targetIds]);
			const crossingRelations = crossingRelationIds.map((relationId) => {
				const relation = prepared.graph.relations.find(
					({ relation: item }) => item.id === relationId,
				);
				if (relation === undefined) throw new Error(`Missing crossing relation ${relationId}`);
				return relation.relation;
			});
			expect(countRankOrderCrossings(placedOrder, crossingRelations)).toBe(1);
			const routeCrossings = routeBridgeAnalysis(layout.relations).crossings;
			expect(
				routeCrossings.some(
					({ horizontalId, verticalId }) =>
						new Set([horizontalId, verticalId]).size === 2 &&
						crossingRelationIds.every((relationId) =>
							[horizontalId, verticalId].includes(relationId),
						),
				),
			).toBe(true);

			const cycle = channelFor(channels, id, crossingRelationIds);
			const split = wireFor(cycle, splitId);
			const other = wireFor(cycle, otherId);
			const splitFirst = split.first;
			const splitLast = split.last;
			const otherFirst = other.first;
			expect(split.middle).toBeDefined();
			expect(other.middle).toBeUndefined();
			if (!splitFirst || !splitLast || !otherFirst)
				throw new Error('The production crossing cycle must expose its ordered runs');
			const splitInput = cycle.endpoints.find(({ id }) => id === splitId);
			const otherInput = cycle.endpoints.find(({ id }) => id === otherId);
			expect(splitInput?.source).toBe(otherInput?.target);
			expect(splitInput?.target).toBe(otherInput?.source);
			expect(splitFirst).not.toBe(splitLast);
			expect(splitFirst.next).toContain(splitLast);
			expect(otherFirst.next).toContain(splitLast);
			expect([splitFirst.depth, otherFirst.depth, splitLast.depth]).toEqual([0, 1, 2]);
			expect([splitFirst.rail, otherFirst.rail, splitLast.rail]).toEqual([0, 1, 2]);
		}

		const adjacentChannel = channelFor(channels, 'adjacent-3+1', [
			'a-to-d',
			'a-to-e',
			'b-to-d',
			'c-to-d',
		]);
		const shortRun = wireFor(adjacentChannel, 'a-to-d').first;
		const longRun = wireFor(adjacentChannel, 'a-to-e').first;
		const nestedRun = wireFor(adjacentChannel, 'b-to-d').first;
		if (!shortRun || !longRun || !nestedRun)
			throw new Error('The production adjacent channel must contain all interval runs');
		expect(longRun.start).toBeLessThan(nestedRun.start);
		expect(longRun.end).toBeGreaterThan(nestedRun.end);
		expect(shortRun.start).toBeLessThan(longRun.start);
		expect(shortRun.end).toBeGreaterThan(longRun.start);
		const releasedRun = wireFor(adjacentChannel, 'b-to-d').first;
		expect(releasedRun?.rail).toBe(shortRun.rail);
		expect(releasedRun?.rail).not.toBe(longRun.rail);
		expect(shortRun.end).toBeLessThan((releasedRun?.start ?? 0) - 12);
		expect(longRun.end).toBeGreaterThanOrEqual((releasedRun?.start ?? 0) - 12);

		const clearance12 = channelFor(channels, 'rail-clearance-12', [
			'a-to-d',
			'a-to-e',
			'b-to-d',
			'c-to-d',
		]);
		const before12 = wireFor(clearance12, 'a-to-d').first;
		const after12 = wireFor(clearance12, 'a-to-e').first;
		if (!before12 || !after12) throw new Error('The 12-unit production channel must have runs');
		expect(after12.start - before12.end).toBe(12);
		expect(after12.rail).not.toBe(before12.rail);
		const clearance13 = channelFor(channels, 'rail-clearance-13', [
			'a-to-d',
			'a-to-e',
			'b-to-d',
			'c-to-d',
		]);
		const before13 = wireFor(clearance13, 'a-to-d').first;
		const after13 = wireFor(clearance13, 'a-to-e').first;
		if (!before13 || !after13) throw new Error('The 13-unit production channel must have runs');
		expect(after13.start - before13.end).toBe(13);
		expect(after13.rail).toBe(before13.rail);

		const reuseChannel = channelFor(channels, 'rail-reuse', ['c-to-e', 'd-to-e']);
		const cToERun = wireFor(reuseChannel, 'c-to-e').first;
		const dToERun = wireFor(reuseChannel, 'd-to-e').first;
		expect(cToERun).toBeDefined();
		expect(dToERun).toBeDefined();
		expect(cToERun?.rail).toBe(dToERun?.rail);
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
	it('characterizes coincident channel endpoints with and without shared ownership', () => {
		const unshared = routeChannel([{ id: 'coincident-unshared', source: 4, target: 4 }]);
		const shared = routeChannel([
			{ id: 'coincident-shared', source: 4, target: 4, sharedSource: 's', sharedTarget: 't' },
		]);
		expect(unshared.wires[0]?.first).toBeUndefined();
		expect(shared.wires[0]?.first).toMatchObject({ start: 4, end: 4, rail: 0 });
		expect(shared.wires[0]?.last).toBe(shared.wires[0]?.first);
	});
	it('characterizes shared cycle dependencies and merged family constraints', () => {
		const sharedCycle = routeChannel([
			{ id: 'shared-forward', source: 0, target: 48, sharedSource: 'source' },
			{ id: 'backward', source: 48, target: 0 },
		]);
		const forward = sharedCycle.wires.find(({ id }) => id === 'shared-forward');
		const backward = sharedCycle.wires.find(({ id }) => id === 'backward');
		if (!forward?.first || !forward.last || !backward?.first || !backward.last)
			throw new Error('The shared column cycle must be split into owned runs');
		expect(forward.first).not.toBe(forward.last);
		expect(backward.first).not.toBe(backward.last);
		expect(forward.first.next).toContain(forward.last);
		expect(forward.first.next).toContain(backward.last);
		expect(backward.first.next).toContain(forward.last);
		expect(backward.first.next).toContain(backward.last);

		const sharedArrivalAndDeparture = routeChannel([
			{
				id: 'both-forward',
				source: 0,
				target: 48,
				sharedSource: 'source',
				sharedTarget: 'arrival',
			},
			{
				id: 'both-backward',
				source: 48,
				target: 0,
				sharedSource: 'source',
				sharedTarget: 'arrival',
			},
		]);
		const [forwardFamily, backwardFamily] = sharedArrivalAndDeparture.wires;
		if (
			!forwardFamily?.first ||
			!forwardFamily.last ||
			!backwardFamily?.first ||
			!backwardFamily.last
		)
			throw new Error('The shared arrival and departure families must be merged');
		expect(forwardFamily.first).toBe(backwardFamily.first);
		expect(forwardFamily.last).toBe(backwardFamily.last);
		expect(forwardFamily.first).not.toBe(forwardFamily.last);
		expect(forwardFamily.first.next).toContain(forwardFamily.last);
	});
	it('preserves relation order when run starts and ends tie exactly', () => {
		const tied = routeChannel([
			{ id: 'tie-a', source: 0, target: 100 },
			{ id: 'tie-b', source: 0, target: 100 },
		]);
		expect(tied.wires.map(({ id, first }) => [id, first?.start, first?.end, first?.rail])).toEqual([
			['tie-a', 0, 100, 0],
			['tie-b', 0, 100, 1],
		]);
	});
});

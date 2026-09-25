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
import { packRails } from '../../../../src/lib/core/layout/routing/rail-packing';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
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
	for (const value of values) expect(Number.isFinite(value)).toBe(true);
}
function placedIds(
	layout: ReturnType<typeof layoutWithDedicatedEngine>,
	ids: readonly string[],
): string[] {
	return ids.toSorted((left, right) => {
		const leftElement = layout.elements.find(({ id }) => id === left);
		const rightElement = layout.elements.find(({ id }) => id === right);
		expect(leftElement).toBeDefined();
		expect(rightElement).toBeDefined();
		return (leftElement?.bounds.x ?? 0) - (rightElement?.bounds.x ?? 0);
	});
}

const rankCases = rankOrderComparisonCorpus()
	.slice(0, 2)
	.map(({ id, document }) => ({ id, document }));
const cases = [
	...rankCases,
	{ id: 'multirank-group-junction-one', document: multirankOne },
	{ id: 'multirank-group-junction-two', document: multirankTwo },
	{ id: 'junction-channel-families', document: junctionChannelFamilies },
	{ id: 'group-endpoint-route', document: groupEndpoint },
	{ id: 'rail-reuse', document: railReuse },
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
		const allCases = [
			...cases,
			{ id: 'ai-documentary-effort', document: aiDocument.value },
			...workshopCases,
		];
		const channels = new Map<string, readonly ChannelObservation[]>();
		const preparedById = new Map<string, ReturnType<typeof prepareLayoutDocument>>();
		const results = Object.fromEntries(
			allCases.map(({ id, document }) => {
				const prepared = prepareLayoutDocument(document);
				preparedById.set(id, prepared);
				channelObservations.calls.length = 0;
				const result = layoutWithDedicatedEngine(
					prepared.graph,
					prepared.ranks,
					prepared.measurements,
					{ inspectRouting: true },
				);
				channels.set(id, [...channelObservations.calls]);
				assertFiniteLayout(result);
				return [id, result];
			}),
		);
		const hashes = Object.fromEntries(
			Object.entries(results).map(([id, result]) => [id, digest(result)]),
		);

		expect(
			results['junction-channel-families']?.elements.some(
				({ kind }) => kind === EndpointKind.Junction,
			),
		).toBe(true);
		expect(results['group-endpoint-route']?.relations.some(({ from }) => from === 'group')).toBe(
			true,
		);
		const familyCalls = channels.get('junction-channel-families') ?? [];
		const familyEndpoints = familyCalls.flatMap(({ endpoints }) => endpoints);
		expect(
			familyEndpoints.some(
				({ id, sharedSource, sharedTarget }) =>
					id === 'j-to-sink' && sharedSource !== undefined && sharedTarget === 'sink',
			),
		).toBe(true);
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
		const sharedCoincident = coincidentCalls.flatMap(({ endpoints, routing }) =>
			endpoints
				.filter(
					({ source, target, sharedSource, sharedTarget }) =>
						source === target && (sharedSource !== undefined || sharedTarget !== undefined),
				)
				.map(({ id }) => routing.wires.find((wire) => wire.id === id)),
		);
		expect(sharedCoincident).toHaveLength(0);
		expect(
			familyCalls.some(({ endpoints, routing }) => {
				const sharedFamilyRuns = endpoints
					.filter(({ sharedTarget }) => sharedTarget === 'sink')
					.flatMap(({ id }) => routing.wires.filter((wire) => wire.id === id));
				return (
					sharedFamilyRuns.length > 1 &&
					sharedFamilyRuns.every(({ first }) => first === sharedFamilyRuns[0]?.first)
				);
			}),
		).toBe(true);
		for (const id of ['multirank-group-junction-one', 'multirank-group-junction-two']) {
			const layout = results[id];
			const prepared = preparedById.get(id);
			expect(layout).toBeDefined();
			expect(prepared).toBeDefined();
			if (!layout || !prepared) throw new Error(`Missing layout fixture ${id}`);
			expect(layout.elements.some(({ kind }) => kind === EndpointKind.Group)).toBe(true);
			expect(layout.elements.some(({ kind }) => kind === EndpointKind.Junction)).toBe(true);
			expect(placedIds(layout, ['a', 'b'])).toEqual(['a', 'b']);
			expect(routeBridgeAnalysis(layout.relations).crossings.length).toBeGreaterThan(0);
			const calls = channels.get(id) ?? [];
			const split = calls
				.flatMap(({ routing }) => routing.wires)
				.find(({ first, last }) => first !== undefined && last !== undefined && first !== last);
			expect(split, id).toBeDefined();
			expect(split?.first?.next).toContain(split?.last);
			expect(split?.first?.rail).not.toBe(split?.last?.rail);
			expect(prepared.ranks.byEndpointId.get('a')).toBe(prepared.ranks.byEndpointId.get('b'));
			expect(Math.max(...prepared.ranks.byEndpointId.values())).toBeGreaterThan(
				Math.min(...prepared.ranks.byEndpointId.values()),
			);
		}
		const documentaryBand = [
			['a', 'b'],
			['c', 'd'],
		];
		const improvedBand = [
			['b', 'a'],
			['c', 'd'],
		];
		expect(countRankOrderCrossings(documentaryBand, multirankOne.relations)).toBe(1);
		expect(countRankOrderCrossings(improvedBand, multirankOne.relations)).toBe(0);
		const secondBand = [
			['c', 'd'],
			['e', 'f'],
		];
		const secondImproved = [
			['d', 'c'],
			['e', 'f'],
		];
		expect(countRankOrderCrossings(secondBand, multirankTwo.relations)).toBe(1);
		expect(countRankOrderCrossings(secondImproved, multirankTwo.relations)).toBe(0);
		expect(results['ai-documentary-effort']?.elements.length).toBeGreaterThan(20);
		expect(results['workshop-branching']?.elements.length).toBeGreaterThan(0);
		expect(results['workshop-navigation']?.elements.length).toBeGreaterThan(0);
		const reuseChannel = (channels.get('rail-reuse') ?? [])
			.map(({ routing }) => routing.wires.filter(({ id }) => id === 'c-to-e' || id === 'd-to-e'))
			.find((runs) => runs.length === 2 && runs.every(({ first }) => first !== undefined));
		expect(reuseChannel).toBeDefined();
		expect(reuseChannel?.[0]?.first?.rail).toBe(reuseChannel?.[1]?.first?.rail);
		const boundary12 = [
			{ start: 0, end: 100, rail: -1 },
			{ start: 112, end: 200, rail: -1 },
		];
		const boundary13 = [
			{ start: 0, end: 100, rail: -1 },
			{ start: 113, end: 200, rail: -1 },
		];
		expect(packRails(boundary12, 0)).toBe(2);
		expect(packRails(boundary13, 0)).toBe(1);
		const nested = [
			{ start: 0, end: 100, rail: -1 },
			{ start: 25, end: 75, rail: -1 },
		];
		expect(packRails(nested, 0)).toBe(2);
		expect(nested.map(({ rail }) => rail)).toEqual([0, 1]);
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
			'rail-reuse': 'bf9eedd9a6eb7669b4b969d292616c8f7367b20b5eb017d6f1aed223c3d52a49',
			'workshop-branching': '007f50ba4f616a515f8c8d08e082536958b139ee39d6ad2cb5ef12236c0e58c4',
			'workshop-navigation': '44bc5d3435f46a72dd2794838daaf7ba425cad1a4b4c551d90747fea8efb1c37',
		});
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
	it('characterizes endpoint ties and minimum-end rail release by relation id', () => {
		const tied = routeChannel([
			{ id: 'tie-a', source: 0, target: 100 },
			{ id: 'tie-b', source: 0, target: 100 },
		]);
		expect(tied.wires.map(({ id, first }) => [id, first?.rail])).toEqual([
			['tie-a', 0],
			['tie-b', 1],
		]);
		const sharedArrival = routeChannel([
			{ id: 'upstream', source: 0, target: 20 },
			{ id: 'arrival-a', source: 20, target: 100, sharedTarget: 'sink' },
			{ id: 'arrival-b', source: 5, target: 100, sharedTarget: 'sink' },
		]);
		const arrivalA = sharedArrival.wires.find(({ id }) => id === 'arrival-a');
		const arrivalB = sharedArrival.wires.find(({ id }) => id === 'arrival-b');
		expect(arrivalA?.first).not.toBe(arrivalB?.first);
		expect(arrivalA?.last).toBe(arrivalB?.last);
		const released = routeChannel([
			{ id: 'long-end', source: 0, target: 30 },
			{ id: 'short-end', source: 0, target: 20 },
			{ id: 'released', source: 35, target: 45 },
		]);
		expect(Object.fromEntries(released.wires.map(({ id, first }) => [id, first?.rail]))).toEqual({
			'long-end': 1,
			'short-end': 0,
			released: 0,
		});
	});

	it('characterizes the strict twelve-unit rail clearance boundary', () => {
		const boundary12 = [
			{ start: 0, end: 100, rail: -1 },
			{ start: 112, end: 200, rail: -1 },
		];
		const boundary13 = [
			{ start: 0, end: 100, rail: -1 },
			{ start: 113, end: 200, rail: -1 },
		];
		expect(packRails(boundary12, 0)).toBe(2);
		expect(packRails(boundary13, 0)).toBe(1);
	});
});

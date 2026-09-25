import { createHash } from 'node:crypto';

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
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { countRankOrderCrossings } from '../../../../src/lib/core/layout/rank-order';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import { packRails } from '../../../../src/lib/core/layout/routing/rail-packing';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

function digest(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function makeDocument(
	id: string,
	ids: readonly string[],
	relations: readonly { id: string; from: string; to: string }[],
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
			layoutOrder: orderKey(`a${index + 1}`),
		})),
		relations,
	};
}

const splitRuns = makeDocument(
	'split-runs',
	['a', 'b', 'c', 'd'],
	[
		{ id: 'a-to-b', from: 'a', to: 'b' },
		{ id: 'b-to-c', from: 'b', to: 'c' },
		{ id: 'c-to-d', from: 'c', to: 'd' },
		{ id: 'a-to-d', from: 'a', to: 'd' },
	],
);
const sharedDeparture = makeDocument(
	'shared-departure-family',
	['a', 'b', 'c', 'd'],
	[
		{ id: 'a-to-c', from: 'a', to: 'c' },
		{ id: 'a-to-d', from: 'a', to: 'd' },
	],
);
const sharedArrival = makeDocument(
	'shared-arrival-family',
	['a', 'b', 'c'],
	[
		{ id: 'a-to-c', from: 'a', to: 'c' },
		{ id: 'b-to-c', from: 'b', to: 'c' },
	],
);
const precedence = makeDocument(
	'run-precedence',
	['a', 'b', 'c', 'd', 'e'],
	[
		{ id: 'a-to-c', from: 'a', to: 'c' },
		{ id: 'c-to-e', from: 'c', to: 'e' },
		{ id: 'b-to-d', from: 'b', to: 'd' },
	],
);
const equalRuns = makeDocument(
	'equal-run-intervals',
	['a', 'b', 'c', 'd'],
	[
		{ id: 'a-to-d-one', from: 'a', to: 'd' },
		{ id: 'a-to-d-two', from: 'a', to: 'd' },
	],
);

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
				layoutOrder: orderKey('a6'),
			},
		],
	};
}
const multilayerGroupJunctionOne = groupedJunction('multilayer-group-junction-one', [
	{ id: 'a-to-d', from: 'a', to: 'd' },
	{ id: 'b-to-c', from: 'b', to: 'c' },
	{ id: 'c-to-e', from: 'c', to: 'e' },
	{ id: 'd-to-f', from: 'd', to: 'f' },
	{ id: 'e-to-join', from: 'e', to: 'join' },
	{ id: 'f-to-join', from: 'f', to: 'join' },
]);
const multilayerGroupJunctionTwo = groupedJunction('multilayer-group-junction-two', [
	{ id: 'a-to-c', from: 'a', to: 'c' },
	{ id: 'b-to-d', from: 'b', to: 'd' },
	{ id: 'c-to-f', from: 'c', to: 'f' },
	{ id: 'd-to-e', from: 'd', to: 'e' },
	{ id: 'e-to-join', from: 'e', to: 'join' },
	{ id: 'f-to-join', from: 'f', to: 'join' },
]);

function sharedEndpointPoints(
	left: readonly { x: number; y: number }[],
	right: readonly { x: number; y: number }[],
	fromStart: boolean,
): number {
	let count = 0;
	while (count < left.length && count < right.length) {
		let leftPoint;
		let rightPoint;
		if (fromStart) {
			leftPoint = left[count];
			rightPoint = right[count];
		} else {
			leftPoint = left[left.length - count - 1];
			rightPoint = right[right.length - count - 1];
		}
		if (leftPoint === undefined || rightPoint === undefined) break;
		if (leftPoint.x !== rightPoint.x || leftPoint.y !== rightPoint.y) break;
		count += 1;
	}
	return count;
}

function dedicatedLayout(input: LogicDocument) {
	const prepared = prepareLayoutDocument(input);
	return layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
}

const rankCases = rankOrderComparisonCorpus()
	.slice(0, 2)
	.map(({ id, document }) => ({ id, document }));
const cases = [
	...rankCases,
	{ id: 'split-runs', document: splitRuns },
	{ id: 'shared-departure-family', document: sharedDeparture },
	{ id: 'shared-arrival-family', document: sharedArrival },
	{ id: 'run-precedence', document: precedence },
	{ id: 'equal-run-intervals', document: equalRuns },
	{ id: 'multilayer-group-junction-one', document: multilayerGroupJunctionOne },
	{ id: 'multilayer-group-junction-two', document: multilayerGroupJunctionTwo },
];

describe('dedicated engine LayoutResult identity', () => {
	it('exercises the channel run and clearance mechanisms named by the corpus', () => {
		const brokenCycle = routeChannel([
			{ id: 'left', source: 0, target: 0 },
			{ id: 'a', source: 48, target: 96 },
			{ id: 'b', source: 96, target: 48 },
			{ id: 'right', source: 144, target: 144 },
		]);
		const broken = brokenCycle.wires.find(({ middle }) => middle !== undefined);
		expect(broken?.first).not.toBe(broken?.last);
		expect(broken?.first?.next).toContain(broken?.last);

		const departures = routeChannel([
			{ id: 'depart-one', source: 0, target: 48, sharedSource: 'source-family' },
			{ id: 'depart-two', source: 0, target: 96, sharedSource: 'source-family' },
		]).wires;
		expect(departures[0]?.first).toBe(departures[1]?.first);
		const arrivals = routeChannel([
			{ id: 'arrive-one', source: 0, target: 96, sharedTarget: 'target-family' },
			{ id: 'arrive-two', source: 48, target: 96, sharedTarget: 'target-family' },
		]).wires;
		expect(arrivals[0]?.last).toBe(arrivals[1]?.last);

		const equalIntervalWires = routeChannel([
			{ id: 'equal-one', source: 0, target: 96 },
			{ id: 'equal-two', source: 0, target: 96 },
		]).wires;
		expect(equalIntervalWires[0]?.first?.start).toBe(equalIntervalWires[1]?.first?.start);
		expect(equalIntervalWires[0]?.first?.end).toBe(equalIntervalWires[1]?.first?.end);
		expect(equalIntervalWires[0]?.first?.rail).not.toBe(equalIntervalWires[1]?.first?.rail);
	});

	it('pins full-layout hashes for representative routing and rank shapes', () => {
		const results = Object.fromEntries(
			cases.map(({ id, document }) => [id, dedicatedLayout(document)]),
		);
		const hashes = Object.fromEntries(
			Object.entries(results).map(([id, result]) => [id, digest(result)]),
		);
		expect(hashes).toEqual({
			'adjacent-3+1': '273981f22108c976d075cb26f34f02cd993f9a3fde44c192d3ef796392f1792c',
			'adjacent-2+2': '08b268e4e888afb39ccded9544acfeae38026730d95f907c9a4b7be3d4a5ea7d',
			'split-runs': '512e09a8b59c2621c6af00978d0dc979b947112d22e3bd7755c2c0249b223289',
			'shared-departure-family': '850b92bc4580c34496096cabecbd8bf8c43da3cecebd0811bbfa10ee8534c904',
			'shared-arrival-family': '38991d770f439e318c8510cbf9f320d5d78f105b7512bddc2895505a6a72a5f9',
			'run-precedence': '5ef80c7570e6f8da8d00f034213b7d1abe37afda0005978ce598ca4a8a9b908a',
			'equal-run-intervals': '2fbd2d43a282d466efcf145a1cd1ff531dbf46d7e4af055db88ba9512984f767',
			'multilayer-group-junction-one':
				'720d2d8248519b945873ea5b7e18fe7ba987fb997b292de4431f5a2d7610d63e',
			'multilayer-group-junction-two':
				'a3b31810663a2fde5c518f536388da03c428e49b49915d594a37a892c78f4ac5',
		});
		expect(results['adjacent-3+1']?.relations).toHaveLength(4);
		expect(results['adjacent-2+2']?.relations).toHaveLength(4);
		expect(results['split-runs']?.relations).toHaveLength(4);
		expect(
			results['split-runs']?.relations.find(({ id }) => id === 'a-to-d')?.points.length,
		).toBeGreaterThan(2);
		expect(results['shared-departure-family']?.relations).toHaveLength(2);
		const departures = results['shared-departure-family']?.relations ?? [];
		expect(
			sharedEndpointPoints(departures[0]?.points ?? [], departures[1]?.points ?? [], true),
		).toBeGreaterThan(1);
		expect(results['shared-arrival-family']?.relations).toHaveLength(2);
		const arrivals = results['shared-arrival-family']?.relations ?? [];
		expect(
			sharedEndpointPoints(arrivals[0]?.points ?? [], arrivals[1]?.points ?? [], false),
		).toBeGreaterThan(1);
		expect(results['run-precedence']?.relations).toHaveLength(3);
		expect(results['equal-run-intervals']?.relations).toHaveLength(2);
		expect(results['equal-run-intervals']?.relations[0]?.points).toEqual(
			results['equal-run-intervals']?.relations[1]?.points,
		);
		const reusedAtClearance = [
			{ start: 0, end: 20, rail: -1 },
			{ start: 33, end: 50, rail: -1 },
		];
		expect(packRails(reusedAtClearance, 0)).toBe(1);
		expect(reusedAtClearance.map(({ rail }) => rail)).toEqual([0, 0]);
		const notReusedAtTwelve = [
			{ start: 0, end: 20, rail: -1 },
			{ start: 32, end: 50, rail: -1 },
		];
		expect(packRails(notReusedAtTwelve, 0)).toBe(2);
		const documentaryBand = [
			['a', 'b'],
			['c', 'd'],
		];
		const improvedBand = [
			['b', 'a'],
			['c', 'd'],
		];
		expect(countRankOrderCrossings(documentaryBand, multilayerGroupJunctionOne.relations)).toBe(1);
		expect(countRankOrderCrossings(improvedBand, multilayerGroupJunctionOne.relations)).toBe(0);
		const secondCrossing = [
			['c', 'd'],
			['e', 'f'],
		];
		const secondImproved = [
			['d', 'c'],
			['e', 'f'],
		];
		expect(countRankOrderCrossings(secondCrossing, multilayerGroupJunctionTwo.relations)).toBe(1);
		expect(countRankOrderCrossings(secondImproved, multilayerGroupJunctionTwo.relations)).toBe(0);
		for (const id of ['multilayer-group-junction-one', 'multilayer-group-junction-two']) {
			expect(results[id]?.elements.some(({ kind }) => kind === EndpointKind.Group)).toBe(true);
			expect(results[id]?.elements.some(({ kind }) => kind === EndpointKind.Junction)).toBe(true);
		}
	});
});

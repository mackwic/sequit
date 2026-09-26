import { describe, expect, it, vi } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import type * as ChannelRoutingModule from '../../../../src/lib/core/layout/routing/channel-routing';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import type {
	ChannelEndpoint,
	ChannelRouting,
} from '../../../../src/lib/core/layout/routing/channel-types';
import type { LayoutMeasurementOverrides } from '../../../support/builders/layout-measurements';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	outsideRankSearchEnvelope,
	railClearanceDocument,
	railClearanceMeasurements,
	railReuseDocument,
} from '../../../support/scenarios/dedicated-channel-witnesses';

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

const correctedGroupDocuments = [
	groupedJunction('multirank-group-junction-one', [
		{ id: 'a-to-d', from: 'a', to: 'd' },
		{ id: 'b-to-c', from: 'b', to: 'c' },
		{ id: 'c-to-e', from: 'c', to: 'e' },
		{ id: 'd-to-f', from: 'd', to: 'f' },
		{ id: 'e-to-join', from: 'e', to: 'join' },
		{ id: 'f-to-join', from: 'f', to: 'join' },
	]),
	groupedJunction('multirank-group-junction-two', [
		{ id: 'a-to-c', from: 'a', to: 'c' },
		{ id: 'b-to-d', from: 'b', to: 'd' },
		{ id: 'c-to-f', from: 'c', to: 'f' },
		{ id: 'd-to-e', from: 'd', to: 'e' },
		{ id: 'e-to-join', from: 'e', to: 'join' },
		{ id: 'f-to-join', from: 'f', to: 'join' },
	]),
].map(outsideRankSearchEnvelope);

const junctionNetwork: LogicDocument = {
	...makeDocument(
		'junction-network',
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

function channelsFromProductionLayout(
	document: LogicDocument,
	overrides?: LayoutMeasurementOverrides,
	requireSinglePipeline = false,
): readonly ChannelObservation[] {
	const prepared = prepareLayoutDocument(document, overrides);
	channelObservations.calls.length = 0;
	const selected = layoutWithDedicatedEngineAndRankOrderWitness(
		prepared.graph,
		prepared.ranks,
		prepared.measurements,
		{ inspectRouting: true },
	);
	if (requireSinglePipeline) expect(selected.witness.evaluated).toBe(1);
	return [...channelObservations.calls];
}

function channelFor(
	channels: readonly ChannelObservation[],
	relationIds: readonly string[],
): ChannelObservation {
	const channel = channels.find(({ endpoints }) =>
		relationIds.every((relationId) => endpoints.some(({ id }) => id === relationId)),
	);
	if (channel === undefined)
		throw new Error(`Missing production channel: ${relationIds.join(', ')}`);
	return channel;
}

/** Select observations whose allocated ports coincide with the returned route attachments. */
function finalChannelFor(
	document: LogicDocument,
	relationIds: readonly string[],
): ChannelObservation {
	const prepared = prepareLayoutDocument(document);
	channelObservations.calls.length = 0;
	const production = layoutWithDedicatedEngineAndRankOrderWitness(
		prepared.graph,
		prepared.ranks,
		prepared.measurements,
		{ inspectRouting: true },
	);
	expect(production.witness.evaluated).toBe(1);
	const layout = production.layout;
	const matches = channelObservations.calls.filter(({ endpoints }) =>
		relationIds.every((id) => {
			const endpoint = endpoints.find((candidate) => candidate.id === id);
			const route = layout.relations.find((candidate) => candidate.id === id);
			return (
				endpoint !== undefined &&
				route !== undefined &&
				endpoint.source === route.points[0]?.x &&
				endpoint.target === route.points.at(-1)?.x
			);
		}),
	);
	if (matches.length === 0) throw new Error('No routed channel matches the returned attachments');
	const signatures = matches.map(({ routing }) =>
		JSON.stringify(
			relationIds.map((id) => {
				const wire = routing.wires.find((candidate) => candidate.id === id);
				return [
					wire?.middle,
					wire?.first?.depth,
					wire?.first?.rail,
					wire?.last?.depth,
					wire?.last?.rail,
				];
			}),
		),
	);
	if (new Set(signatures).size !== 1)
		throw new Error('Port-identical candidate channels disagree on allocated runs');
	const selected = matches.at(-1);
	if (selected === undefined) throw new Error('A final channel must exist');
	return selected;
}

function wireFor(channel: ChannelObservation, id: string) {
	const wire = channel.routing.wires.find((candidate) => candidate.id === id);
	if (wire === undefined) throw new Error(`Missing channel wire ${id}`);
	return wire;
}

describe('dedicated engine channel characterization (replaceable during channel migration)', () => {
	describe('actual port allocations from LogicDocument layouts', () => {
		it('reuses a retained production rail only after its prior interval clears', () => {
			const document = railReuseDocument();
			const channel = channelFor(channelsFromProductionLayout(document, undefined, true), [
				'c-to-e',
				'd-to-e',
			]);
			const earlier = wireFor(channel, 'c-to-e').first;
			const later = wireFor(channel, 'd-to-e').first;
			if (earlier === undefined || later === undefined)
				throw new Error('The retained rail-reuse routes must allocate both runs');
			expect(later.start - earlier.end).toBeGreaterThan(12);
			expect(later.depth).toBe(earlier.depth);
			expect(later.rail).toBe(earlier.rail);
		});
		it.each([12, 13] as const)('keeps a %i-unit gap on the retained channel', (clearance) => {
			const channel = channelFor(
				channelsFromProductionLayout(
					railClearanceDocument(),
					railClearanceMeasurements(clearance),
					true,
				),
				['a-to-d', 'a-to-e'],
			);
			const earlier = wireFor(channel, 'a-to-d').first;
			const later = wireFor(channel, 'a-to-e').first;
			if (earlier === undefined || later === undefined)
				throw new Error('The clearance routes must allocate two runs');
			expect(later.start - earlier.end).toBe(clearance);
			expect(later.depth).toBe(earlier.depth);
			if (clearance === 12) expect(later.rail).not.toBe(earlier.rail);
			else expect(later.rail).toBe(earlier.rail);
		});

		it('characterizes actual endpoints and unsplit rails on both corrected crossing layouts', () => {
			const observations = [
				{
					document: correctedGroupDocuments[0],
					ids: ['a-to-d', 'b-to-c'],
					ports: [
						[454, 710],
						[710, 174],
					],
					rails: [1, 0],
				},
				{
					document: correctedGroupDocuments[1],
					ids: ['c-to-f', 'd-to-e'],
					ports: [
						[174, 430],
						[710, 174],
					],
					rails: [0, 1],
				},
			];
			for (const { document, ids, ports, rails } of observations) {
				if (document === undefined) throw new Error('Both corrected documents must exist');
				const channel = finalChannelFor(document, ids);
				for (const [index, id] of ids.entries()) {
					const endpoint = channel.endpoints.find((candidate) => candidate.id === id);
					const wire = wireFor(channel, id);
					expect([endpoint?.source, endpoint?.target]).toEqual(ports[index]);
					expect(wire.middle).toBeUndefined();
					expect(wire.first).toBe(wire.last);
					expect([wire.first?.depth, wire.first?.rail]).toEqual([rails[index], rails[index]]);
				}
			}
		});

		it('observes split-run cycle and precedence on an allocated document without groups', () => {
			const document = outsideRankSearchEnvelope(
				makeDocument(
					'allocated-cycle',
					['a', 'b', 'c', 'd', 'e', 'f'],
					[
						{ id: 'a-d', from: 'a', to: 'd' },
						{ id: 'b-c', from: 'b', to: 'c' },
						{ id: 'b-d', from: 'b', to: 'd' },
						{ id: 'c-f', from: 'c', to: 'f' },
						{ id: 'd-f', from: 'd', to: 'f' },
					],
				),
			);
			const channel = finalChannelFor(document, ['a-d', 'b-c']);
			const splitInput = channel.endpoints.find(({ id }) => id === 'a-d');
			const inverseInput = channel.endpoints.find(({ id }) => id === 'b-c');
			const split = wireFor(channel, 'a-d');
			const inverse = wireFor(channel, 'b-c');
			expect([splitInput?.source, splitInput?.target]).toEqual([466, 698]);
			expect([inverseInput?.source, inverseInput?.target]).toEqual([698, 466]);
			expect(split.middle).toBeCloseTo(543.3333333333334);
			expect(inverse.middle).toBeUndefined();
			if (!split.first || !split.last || !inverse.first)
				throw new Error('Allocated inverse ports must produce owned runs');
			expect(split.first).not.toBe(split.last);
			expect(split.first.next).toContain(split.last);
			expect(inverse.first.next).toContain(split.last);
			expect([split.first.depth, inverse.first.depth, split.last.depth]).toEqual([0, 1, 2]);
			expect([split.first.rail, inverse.first.rail, split.last.rail]).toEqual([0, 1, 2]);
		});

		it('observes arrival and departure families created by allocated junction ports', () => {
			const channels = channelsFromProductionLayout(junctionNetwork);
			const familyIds = [
				'j-to-a',
				'j-to-d-one',
				'j-to-d-two',
				'j-to-sink',
				'k-to-a',
				'k-to-b',
				'k-to-sink',
			];
			const departureFamily = channelFor(channels, familyIds);
			for (const id of ['j-to-sink', 'k-to-sink']) {
				const endpoint = departureFamily.endpoints.find((candidate) => candidate.id === id);
				expect(endpoint?.sharedSource).toBeDefined();
				expect(endpoint?.sharedTarget).toBe('sink');
			}
			const jDeparture = wireFor(departureFamily, 'j-to-a').first;
			if (jDeparture === undefined) throw new Error('The production departure family must route');
			for (const id of ['j-to-d-one', 'j-to-d-two'])
				expect(wireFor(departureFamily, id).first).toBe(jDeparture);
			expect(wireFor(departureFamily, 'j-to-sink').first).not.toBe(jDeparture);

			const arrivalFamily = channelFor(channels, [
				'a-to-sink',
				'b-to-sink',
				'j-to-sink',
				'k-to-sink',
			]);
			const sharedArrival = wireFor(arrivalFamily, 'a-to-sink').last;
			if (sharedArrival === undefined) throw new Error('The production arrival family must route');
			for (const id of ['b-to-sink', 'j-to-sink', 'k-to-sink'])
				expect(wireFor(arrivalFamily, id).last).toBe(sharedArrival);

			const unsharedCoincident = channels.flatMap(({ endpoints, routing }) =>
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
		});
	});

	describe('direct routeChannel contract only; synthetic endpoint values are not layout evidence', () => {
		// A single wire cannot receive a shared-port key from port allocation; this direct case is unit-only.
		it('characterizes coincident endpoints with and without shared ownership', () => {
			const unshared = routeChannel([{ id: 'coincident-unshared', source: 4, target: 4 }]);
			const shared = routeChannel([
				{ id: 'coincident-shared', source: 4, target: 4, sharedSource: 's', sharedTarget: 't' },
			]);
			expect(unshared.wires[0]?.first).toBeUndefined();
			expect(shared.wires[0]?.first).toMatchObject({ start: 4, end: 4, rail: 0 });
			expect(shared.wires[0]?.last).toBe(shared.wires[0]?.first);
		});

		// These handcrafted keys are not allocated from their one-wire/inverse endpoint provenance.
		// The allocated cycle and junction families have separate documentary witnesses above.
		it('characterizes shared cycle dependencies and merged family constraints', () => {
			const sharedCycle = routeChannel([
				{ id: 'shared-forward', source: 0, target: 48, sharedSource: 'source' },
				{ id: 'backward', source: 48, target: 0 },
			]);
			const forward = sharedCycle.wires.find(({ id }) => id === 'shared-forward');
			const backward = sharedCycle.wires.find(({ id }) => id === 'backward');
			if (!forward?.first || !forward.last || !backward?.first || !backward.last)
				throw new Error('The isolated shared-column cycle must be split into owned runs');
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
				throw new Error('The isolated shared arrival and departure families must merge');
			expect(forwardFamily.first).toBe(backwardFamily.first);
			expect(forwardFamily.last).toBe(backwardFamily.last);
			expect(forwardFamily.first).not.toBe(forwardFamily.last);
			expect(forwardFamily.first.next).toContain(forwardFamily.last);
		});

		// Synthetic direct-API tie only; it is not evidence in the layout SHA corpus.
		it('breaks exact run ties by relation ID regardless of input order', () => {
			const endpointOrders = [
				[
					{ id: 'tie-b', source: 0, target: 100 },
					{ id: 'tie-a', source: 0, target: 100 },
				],
				[
					{ id: 'tie-a', source: 0, target: 100 },
					{ id: 'tie-b', source: 0, target: 100 },
				],
			];
			for (const endpoints of endpointOrders) {
				const tied = routeChannel(endpoints);
				const tieA = tied.wires.find(({ id }) => id === 'tie-a')?.first;
				const tieB = tied.wires.find(({ id }) => id === 'tie-b')?.first;
				expect(tieA && [tieA.start, tieA.end, tieA.rail]).toEqual([0, 100, 0]);
				expect(tieB && [tieB.start, tieB.end, tieB.rail]).toEqual([0, 100, 1]);
			}
		});
	});
});

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
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import type * as ChannelRoutingModule from '../../../../src/lib/core/layout/routing/channel-routing';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import type {
	ChannelEndpoint,
	ChannelRouting,
} from '../../../../src/lib/core/layout/routing/channel-types';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

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

const productionCycleDocuments = [
	{
		id: 'multirank-group-junction-one',
		document: groupedJunction('multirank-group-junction-one', [
			{ id: 'a-to-d', from: 'a', to: 'd' },
			{ id: 'b-to-c', from: 'b', to: 'c' },
			{ id: 'c-to-e', from: 'c', to: 'e' },
			{ id: 'd-to-f', from: 'd', to: 'f' },
			{ id: 'e-to-join', from: 'e', to: 'join' },
			{ id: 'f-to-join', from: 'f', to: 'join' },
		]),
		crossingIds: ['a-to-d', 'b-to-c'] as const,
		splitId: 'a-to-d',
		otherId: 'b-to-c',
	},
	{
		id: 'multirank-group-junction-two',
		document: groupedJunction('multirank-group-junction-two', [
			{ id: 'a-to-c', from: 'a', to: 'c' },
			{ id: 'b-to-d', from: 'b', to: 'd' },
			{ id: 'c-to-f', from: 'c', to: 'f' },
			{ id: 'd-to-e', from: 'd', to: 'e' },
			{ id: 'e-to-join', from: 'e', to: 'join' },
			{ id: 'f-to-join', from: 'f', to: 'join' },
		]),
		crossingIds: ['c-to-f', 'd-to-e'] as const,
		splitId: 'c-to-f',
		otherId: 'd-to-e',
	},
];
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

function channelsFromProductionLayout(document: LogicDocument): readonly ChannelObservation[] {
	const prepared = prepareLayoutDocument(document);
	channelObservations.calls.length = 0;
	layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements, {
		inspectRouting: true,
	});
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

function wireFor(channel: ChannelObservation, id: string) {
	const wire = channel.routing.wires.find((candidate) => candidate.id === id);
	if (wire === undefined) throw new Error(`Missing channel wire ${id}`);
	return wire;
}

describe('dedicated engine channel characterization (replaceable during channel migration)', () => {
	describe('actual port allocations from LogicDocument layouts', () => {
		it('reuses the earliest of two eligible rails with distinct ends by relation ID', () => {
			const entry = rankOrderComparisonCorpus().find(({ id }) => id === 'adjacent-2+2');
			if (entry === undefined) throw new Error('The adjacent 2+2 document must exist');
			const channel = channelFor(channelsFromProductionLayout(entry.document), [
				'a-d',
				'a-e',
				'b-d',
				'c-e',
			]);
			const later = wireFor(channel, 'c-e').first;
			const earlierEnd = wireFor(channel, 'b-d').first;
			const laterEnd = wireFor(channel, 'a-e').first;
			if (later === undefined || earlierEnd === undefined || laterEnd === undefined)
				throw new Error('All three production intervals must have allocated runs');

			const clearanceBoundary = later.start - 12;
			expect(earlierEnd.end).toBeLessThan(clearanceBoundary);
			expect(laterEnd.end).toBeLessThan(clearanceBoundary);
			expect(earlierEnd.end).not.toBe(laterEnd.end);
			expect(earlierEnd.depth).toBe(laterEnd.depth);
			expect(earlierEnd.depth).toBe(later.depth);
			expect(earlierEnd.end).toBeLessThan(laterEnd.end);
			expect(later.rail).toBe(earlierEnd.rail);
			expect(later.rail).not.toBe(laterEnd.rail);
		});

		it('observes split runs and their dependency cycle on routed crossing documents', () => {
			for (const { document, crossingIds, splitId, otherId } of productionCycleDocuments) {
				const channel = channelFor(channelsFromProductionLayout(document), crossingIds);
				const split = wireFor(channel, splitId);
				const other = wireFor(channel, otherId);
				const splitFirst = split.first;
				const splitLast = split.last;
				const otherFirst = other.first;
				const splitInput = channel.endpoints.find(({ id }) => id === splitId);
				const otherInput = channel.endpoints.find(({ id }) => id === otherId);
				if (!splitFirst || !splitLast || !otherFirst || !splitInput || !otherInput)
					throw new Error('Production crossing channels must expose their source runs');
				expect(split.middle).toBeDefined();
				expect(other.middle).toBeUndefined();
				expect(splitInput.source).toBe(otherInput.target);
				expect(splitInput.target).toBe(otherInput.source);
				expect(splitFirst).not.toBe(splitLast);
				expect(splitFirst.next).toContain(splitLast);
				expect(otherFirst.next).toContain(splitLast);
				expect([splitFirst.depth, otherFirst.depth, splitLast.depth]).toEqual([0, 1, 2]);
				expect([splitFirst.rail, otherFirst.rail, splitLast.rail]).toEqual([0, 1, 2]);
			}
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
		// Production cycles and arrival/departure families are asserted from real documents above.
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

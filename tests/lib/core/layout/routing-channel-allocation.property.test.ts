import fc from 'fast-check';
import { expect, it } from 'vitest';

import { EndpointKind, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type { GraphEndpoint } from '../../../../src/lib/core/graph/create-graph';
import { countChannelCrossings } from '../../../../src/lib/core/layout/routing/channel-crossing-cost';
import { allocateChannelIntervals } from '../../../../src/lib/core/layout/routing/channel-interval-allocation';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import type {
	ChannelRouting,
	ChannelRun,
} from '../../../../src/lib/core/layout/routing/channel-types';
import { channelPoints } from '../../../../src/lib/core/layout/routing/materialize-node-routes';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { referenceRouteBridgeAnalysis } from './bridge-oracle-reference';

function retainedRuns(channel: ChannelRouting): Set<ChannelRun> {
	return new Set(
		channel.wires.flatMap(({ first, last }) => [first, last]).filter((run) => run !== undefined),
	);
}

function channelPaths(channel: ChannelRouting, direction: LayoutDirection) {
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	let sign = -1;
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.LeftToRight)
		sign = 1;
	return channel.wires.map((wire) => ({
		...wire,
		points: channelPoints(wire, 0, sign * (channel.railCount + 2) * 24, {
			vertical,
			railStart: sign * 24,
			railStep: sign * 24,
		}),
	}));
}

it('keeps run occurrences unique and precedence intact across split and merged families', () => {
	fc.assert(
		fc.property(fc.integer({ min: -1000, max: 1000 }), (shift) => {
			const split = routeChannel([
				{ id: 'left', source: shift + 48, target: shift + 96 },
				{ id: 'right', source: shift + 96, target: shift + 48 },
			]);
			const sharedInputs = [
				{ id: 'left', source: shift, target: shift + 48, sharedSource: 'common' },
				{ id: 'right', source: shift, target: shift + 96, sharedSource: 'common' },
			];
			const shared = routeChannel(sharedInputs);
			const arrivalsInputs = [
				{ id: 'left', source: shift, target: shift + 96, sharedTarget: 'common' },
				{ id: 'right', source: shift + 48, target: shift + 96, sharedTarget: 'common' },
			];
			const arrivals = routeChannel(arrivalsInputs);
			const divided = split.wires.find(({ middle }) => middle !== undefined);
			expect(divided?.first?.key).not.toBe(divided?.last?.key);
			expect(divided?.first?.depth).toBeLessThan(divided?.last?.depth ?? -1);
			expect(shared.wires[0]?.first).toBe(shared.wires[1]?.first);
			expect(arrivals.wires[0]?.last).toBe(arrivals.wires[1]?.last);
			expect(routeChannel(sharedInputs.toReversed()).trackByRunKey).toEqual(shared.trackByRunKey);
			expect(routeChannel(arrivalsInputs.toReversed()).trackByRunKey).toEqual(
				arrivals.trackByRunKey,
			);
			for (const channel of [split, shared, arrivals]) {
				const runs = retainedRuns(channel);
				expect(channel.trackByRunKey.size).toBe(runs.size);
				expect(new Set([...runs].map(({ key }) => key)).size).toBe(runs.size);
				expect(channel.edge.capacity).toBe(channel.railCount);
				for (const run of runs) expect(channel.trackByRunKey.get(run.key)).toBe(run.rail);
			}
		}),
		PROPERTY_PARAMETERS,
	);
});

it('never reuses a track at or below the strict half-spacing clearance', () => {
	fc.assert(
		fc.property(
			fc.array(fc.tuple(fc.integer({ min: -100, max: 100 }), fc.integer({ min: 1, max: 50 })), {
				minLength: 0,
				maxLength: 12,
			}),
			(pairs) => {
				const demands = pairs.map(([start, length], index) => ({
					key: String(index),
					rail: -1,
					start,
					end: start + length,
				}));
				const allocation = allocateChannelIntervals(
					{ ownerId: '@root/channel/property', capacity: demands.length + 2, spacing: 24 },
					demands,
					2,
				);
				for (const [index, first] of demands.entries()) {
					for (const second of demands.slice(index + 1)) {
						if (
							allocation.trackByRunKey.get(first.key) !== allocation.trackByRunKey.get(second.key)
						)
							continue;
						expect(first.end + 12 < second.start || second.end + 12 < first.start).toBe(true);
					}
				}
				expect(allocation.trackByRunKey.size).toBe(demands.length);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('nests both endpoint families in every direction with the minimum clique capacity', () => {
	const endpoint: GraphEndpoint = {
		kind: EndpointKind.Node,
		entity: {
			id: 'family',
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: 'family',
			layoutOrder: orderKey('a1'),
		},
	};
	fc.assert(
		fc.property(
			fc.integer({ min: 2, max: 8 }),
			fc.integer({ min: -1000, max: 1000 }),
			fc.integer({ min: 48, max: 100 }),
			(count, shift, spacing) => {
				for (const sourceFamily of [true, false])
					for (const side of [-1, 1]) {
						let sourceEndpoint: GraphEndpoint | undefined;
						let targetEndpoint: GraphEndpoint | undefined;
						if (sourceFamily) sourceEndpoint = endpoint;
						else targetEndpoint = endpoint;
						const inputs = Array.from({ length: count }, (_, index) => ({
							id: String(index),
							source: shift + side * spacing * index,
							target: shift + side * spacing * (count * 2 + index),
							sourceEndpoint,
							targetEndpoint,
						}));
						const channel = routeChannel(inputs);
						expect(channel.railCount).toBe(count);
						for (const direction of Object.values(LayoutDirection)) {
							const vertical =
								direction === LayoutDirection.TopToBottom ||
								direction === LayoutDirection.BottomToTop;
							let sign = -1;
							if (
								direction === LayoutDirection.TopToBottom ||
								direction === LayoutDirection.LeftToRight
							)
								sign = 1;
							const paths = channel.wires.map((wire) => ({
								id: wire.id,
								points: channelPoints(wire, 0, sign * spacing * (count + 2), {
									vertical,
									railStart: sign * spacing,
									railStep: sign * 24,
								}),
							}));
							expect(referenceRouteBridgeAnalysis(paths).crossings).toEqual([]);
						}
					}
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('never increases sparse channel crossings for endpoint nesting or input permutation', () => {
	const endpoints = Array.from({ length: 10 }, (_, index): GraphEndpoint => ({
		kind: EndpointKind.Node,
		entity: {
			id: String(index),
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: String(index),
			layoutOrder: orderKey('a1'),
		},
	}));
	fc.assert(
		fc.property(
			fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 4 })), {
				minLength: 1,
				maxLength: 25,
				selector: ([source, target]) => `${source}:${target}`,
			}),
			(pairs) => {
				const inputs = pairs.map(([source, target]) => ({
					id: `${source}:${target}`,
					source: 200 + 1000 * source + 48 * target,
					target: 200 + 1000 * target + 48 * source,
					sourceEndpoint: endpoints[source],
					targetEndpoint: endpoints[target + 5],
				}));
				const channel = routeChannel(inputs);
				const baseline = routeChannel(
					inputs.map((wire) => ({
						...wire,
						sourceEndpoint: undefined,
						targetEndpoint: undefined,
					})),
				);
				const reverse = routeChannel(inputs.toReversed());
				for (const direction of Object.values(LayoutDirection)) {
					const paths = channelPaths(channel, direction);
					const baselinePaths = channelPaths(baseline, direction);
					const crossings = referenceRouteBridgeAnalysis(paths).crossings.length;
					expect(crossings).toBeLessThanOrEqual(
						referenceRouteBridgeAnalysis(baselinePaths).crossings.length,
					);
					expect(countChannelCrossings(channel.wires, channel.railCount)).toBe(crossings);
					for (const field of ['sourceEndpoint', 'targetEndpoint'] as const) {
						for (const endpoint of endpoints) {
							const ids = new Set(
								inputs.filter((wire) => wire[field] === endpoint).map((wire) => wire.id),
							);
							if (ids.size < 2) continue;
							expect(
								referenceRouteBridgeAnalysis(paths.filter((path) => ids.has(path.id))).crossings
									.length,
							).toBeLessThanOrEqual(
								referenceRouteBridgeAnalysis(baselinePaths.filter((path) => ids.has(path.id)))
									.crossings.length,
							);
						}
					}
				}
				expect(reverse.railCount).toBe(channel.railCount);
				for (const wire of channel.wires) {
					const other = reverse.wires.find(({ id }) => id === wire.id);
					expect([other?.first?.rail, other?.last?.rail, other?.middle]).toEqual([
						wire.first?.rail,
						wire.last?.rail,
						wire.middle,
					]);
				}
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('prices shared traverses, column-cycle detours and straight wires by their strict crossings', () => {
	fc.assert(
		fc.property(
			fc.array(fc.tuple(fc.integer({ min: -4, max: 4 }), fc.integer({ min: -4, max: 4 })), {
				minLength: 1,
				maxLength: 16,
			}),
			(pairs) => {
				const channel = routeChannel(
					pairs.map(([source, target], index) => {
						let sharedSource: string | undefined;
						let sharedTarget: string | undefined;
						if (source % 2 === 0) sharedSource = `source:${source}`;
						if (target % 2 === 0) sharedTarget = `target:${target}`;
						return {
							id: String(index),
							source: source * 48,
							target: target * 48,
							sharedSource,
							sharedTarget,
						};
					}),
				);
				for (const direction of Object.values(LayoutDirection)) {
					expect(countChannelCrossings(channel.wires, channel.railCount)).toBe(
						referenceRouteBridgeAnalysis(channelPaths(channel, direction)).crossings.length,
					);
				}
			},
		),
		PROPERTY_PARAMETERS,
	);
});

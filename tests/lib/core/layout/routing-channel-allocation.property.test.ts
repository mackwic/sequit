import fc from 'fast-check';
import { expect, it } from 'vitest';

import { allocateChannelIntervals } from '../../../../src/lib/core/layout/routing/channel-interval-allocation';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import type {
	ChannelRouting,
	ChannelRun,
} from '../../../../src/lib/core/layout/routing/channel-types';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

function retainedRuns(channel: ChannelRouting): Set<ChannelRun> {
	return new Set(
		channel.wires.flatMap(({ first, last }) => [first, last]).filter((run) => run !== undefined),
	);
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

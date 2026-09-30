import { describe, expect, it } from 'vitest';

import { routeOwnedChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import {
	ChannelRoutingCache,
	MAX_CHANNEL_ROUTING_GENERATION_WIRES,
} from '../../../../src/lib/core/layout/routing/channel-routing-cache';
import type {
	ChannelEndpoint,
	ChannelRouting,
	ChannelRun,
	ChannelWire,
} from '../../../../src/lib/core/layout/routing/channel-types';

const OWNER = '@root/channel/corridor-1';

/** A source family, a target family, a split pair and a straight wire the router ignores. */
const CHANNEL: readonly ChannelEndpoint[] = [
	{ id: 'family-a', source: 0, target: 48, sharedSource: 'common' },
	{ id: 'family-b', source: 0, target: 96, sharedSource: 'common' },
	{ id: 'arrive-a', source: 144, target: 240, sharedTarget: 'sink' },
	{ id: 'arrive-b', source: 192, target: 240, sharedTarget: 'sink' },
	{ id: 'split-left', source: 288, target: 336 },
	{ id: 'split-right', source: 336, target: 288 },
	{ id: 'straight', source: 400, target: 400 },
];

function wires(endpoints: readonly ChannelEndpoint[]): ChannelWire[] {
	return endpoints.map((endpoint) => ({
		...endpoint,
		first: undefined,
		last: undefined,
		middle: undefined,
	}));
}

/** Which references share one run object, as indices of first sight (-1 for none). */
function sharing(routing: ChannelRouting): number[] {
	const runs: ChannelRun[] = [];
	const indexOf = (run: ChannelRun | undefined): number => {
		if (run === undefined) return -1;
		if (!runs.includes(run)) runs.push(run);
		return runs.indexOf(run);
	};
	const references = routing.wires.flatMap(({ first, last }) => [indexOf(first), indexOf(last)]);
	const following = runs.flatMap(({ next }) => next.map(indexOf));
	return [...references, -2, ...following];
}

function expectFreshEquivalent(actual: ChannelRouting, expected: ChannelRouting): void {
	expect(actual).toEqual(expected);
	expect(sharing(actual)).toEqual(sharing(expected));
	expect([...actual.trackByRunKey]).toEqual([...expected.trackByRunKey]);
}

describe('projection-owned channel routing cache', () => {
	it('replays a routed channel into fresh objects equal to a cold routing', () => {
		const cache = new ChannelRoutingCache();
		const first = cache.route(wires(CHANNEL), false, OWNER);
		const input = wires(CHANNEL);
		const hit = cache.route(input, false, OWNER);
		const cold = routeOwnedChannel(wires(CHANNEL), false, OWNER);
		expect(cache.stats).toEqual({ entries: 1, wires: CHANNEL.length, hits: 1, misses: 1 });
		expectFreshEquivalent(hit, cold);
		expect(hit.wires).toBe(input);
		expect(hit.edge).not.toBe(first.edge);
		expect(hit.trackByRunKey).not.toBe(first.trackByRunKey);
		expect(hit.wires[0]?.first).not.toBe(first.wires[0]?.first);
		expect(hit.wires[0]?.first).toBe(hit.wires[1]?.first);
		expect(hit.wires[2]?.last).toBe(hit.wires[3]?.last);
		expect(hit.wires.filter(({ middle }) => middle !== undefined).map(({ id }) => id)).toEqual([
			'split-left',
			'split-right',
		]);
		expect(hit.wires.at(-1)).toMatchObject({ first: undefined, last: undefined });
	});

	it('keeps remembered routings independent of mutations to returned runs', () => {
		const cache = new ChannelRoutingCache();
		const cold = routeOwnedChannel(wires(CHANNEL), false, OWNER);
		const mutate = (routing: ChannelRouting): void => {
			for (const { first, last } of routing.wires)
				for (const run of [first, last]) {
					if (run === undefined) continue;
					run.rail += 7;
					run.start -= 1;
					run.next.length = 0;
				}
		};
		mutate(cache.route(wires(CHANNEL), false, OWNER));
		mutate(cache.route(wires(CHANNEL), false, OWNER));
		expectFreshEquivalent(cache.route(wires(CHANNEL), false, OWNER), cold);
	});

	const variants: readonly (readonly [string, readonly ChannelEndpoint[], boolean, string])[] = [
		[
			'a moved column',
			CHANNEL.map((wire, index) => ({ ...wire, target: wire.target + Number(index === 4) })),
			false,
			OWNER,
		],
		[
			// Only the shared family starts at column 0; `0 || -0` is -0.
			'a negative zero column',
			CHANNEL.map((wire) => ({ ...wire, source: wire.source || -0 })),
			false,
			OWNER,
		],
		[
			'a changed shared source',
			CHANNEL.map((wire) => ({
				...wire,
				sharedSource: wire.sharedSource?.replace('common', 'other'),
			})),
			false,
			OWNER,
		],
		[
			'a removed shared target',
			CHANNEL.map((wire) => ({ ...wire, sharedTarget: undefined })),
			false,
			OWNER,
		],
		['the corner-only flag', CHANNEL, true, OWNER],
		['another owner', CHANNEL, false, '@root/channel/corridor-2'],
		['a reversed wire order', CHANNEL.toReversed(), false, OWNER],
		[
			'a renamed wire',
			CHANNEL.map((wire) => ({ ...wire, id: `${wire.id}-renamed` })),
			false,
			OWNER,
		],
	];

	it.each(variants)('misses and routes cold after %s', (_name, endpoints, nonInverted, owner) => {
		const cache = new ChannelRoutingCache();
		cache.route(wires(CHANNEL), false, OWNER);
		const routed = cache.route(wires(endpoints), nonInverted, owner);
		expect(cache.stats).toMatchObject({ hits: 0, misses: 2 });
		expectFreshEquivalent(routed, routeOwnedChannel(wires(endpoints), nonInverted, owner));
		expectFreshEquivalent(
			cache.route(wires(endpoints), nonInverted, owner),
			routeOwnedChannel(wires(endpoints), nonInverted, owner),
		);
		expect(cache.stats).toMatchObject({ hits: 1, misses: 2 });
	});

	/** Its two interior wires share every column, so they can swap without changing the key. */
	const SHORT_KEY: readonly ChannelEndpoint[] = [
		{ id: 'head', source: 0, target: 48 },
		{ id: 'inner-a', source: 96, target: 192 },
		{ id: 'inner-b', source: 96, target: 192 },
		{ id: 'tail', source: 240, target: 288 },
	];
	/** Same owner, flag, length, first and last ids and columns as `SHORT_KEY`. */
	const sameShortKey: readonly (readonly [string, readonly ChannelEndpoint[]])[] = [
		[
			'a renamed interior wire',
			SHORT_KEY.map((wire) => ({ ...wire, id: wire.id.replace('inner-a', 'inner-c') })),
		],
		[
			'swapped interior wires',
			[...SHORT_KEY.slice(0, 1), ...SHORT_KEY.slice(1, 3).toReversed(), ...SHORT_KEY.slice(3)],
		],
	];

	it.each(sameShortKey)('misses a channel with the same short key and %s', (_name, endpoints) => {
		const cache = new ChannelRoutingCache();
		cache.route(wires(SHORT_KEY), false, OWNER);
		const routed = cache.route(wires(endpoints), false, OWNER);
		// One entry: the variant replaced the original under the same short key.
		expect(cache.stats).toEqual({ entries: 1, wires: SHORT_KEY.length, hits: 0, misses: 2 });
		expectFreshEquivalent(routed, routeOwnedChannel(wires(endpoints), false, OWNER));
		cache.beginLayout();
		expectFreshEquivalent(
			cache.route(wires(SHORT_KEY), false, OWNER),
			routeOwnedChannel(wires(SHORT_KEY), false, OWNER),
		);
		expect(cache.stats).toMatchObject({ hits: 0, misses: 3 });
	});

	it('keeps a routing used by one of the last two layouts and releases the others', () => {
		const cache = new ChannelRoutingCache();
		const other = CHANNEL.map((wire) => ({ ...wire, id: `other-${wire.id}` }));
		cache.route(wires(CHANNEL), false, OWNER);
		cache.route(wires(other), false, OWNER);
		cache.beginLayout();
		cache.route(wires(CHANNEL), false, OWNER);
		expect(cache.stats).toEqual({ entries: 2, wires: 2 * CHANNEL.length, hits: 1, misses: 2 });
		cache.beginLayout();
		expect(cache.stats).toMatchObject({ entries: 1, wires: CHANNEL.length });
		cache.route(wires(CHANNEL), false, OWNER);
		cache.route(wires(other), false, OWNER);
		expect(cache.stats).toEqual({ entries: 2, wires: 2 * CHANNEL.length, hits: 2, misses: 3 });
		cache.beginLayout();
		cache.beginLayout();
		expect(cache.stats).toMatchObject({ entries: 0, wires: 0 });
	});

	const straight = (prefix: string, count: number): ChannelEndpoint[] =>
		Array.from({ length: count }, (_, index) => ({
			id: `${prefix}-${index}`,
			source: index,
			target: index,
		}));

	it('stops remembering new routings at the ceiling and carries a reused routing that fits', () => {
		const full = straight('full', MAX_CHANNEL_ROUTING_GENERATION_WIRES);
		const extra = straight('extra', 1);
		const cache = new ChannelRoutingCache();
		cache.route(wires(full), false, OWNER);
		cache.route(wires(extra), false, OWNER);
		expect(cache.stats).toEqual({
			entries: 1,
			wires: MAX_CHANNEL_ROUTING_GENERATION_WIRES,
			hits: 0,
			misses: 2,
		});
		cache.beginLayout();
		cache.route(wires(full), false, OWNER);
		cache.route(wires(extra), false, OWNER);
		cache.beginLayout();
		cache.route(wires(full), false, OWNER);
		expect(cache.stats).toEqual({
			entries: 1,
			wires: MAX_CHANNEL_ROUTING_GENERATION_WIRES,
			hits: 2,
			misses: 3,
		});
	});

	it('retains at most the ceiling per layout when new routings precede reused ones', () => {
		const half = MAX_CHANNEL_ROUTING_GENERATION_WIRES / 2;
		const cache = new ChannelRoutingCache();
		const routed: ChannelEndpoint[][] = [];
		const retained: number[] = [];
		for (let layout = 0; layout < 4; layout += 1) {
			routed.unshift(straight(`layout-${layout}`, half));
			for (const channel of routed) cache.route(wires(channel), false, OWNER);
			cache.beginLayout();
			retained.push(cache.stats.wires);
		}
		expect(retained).toEqual([half, 2 * half, 2 * half, 2 * half]);
		// Each layout replays every channel of the previous one, even those it cannot carry over.
		expect(cache.stats).toMatchObject({ hits: 5, misses: 5 });
	});
});

import fc from 'fast-check';
import { expect, it } from 'vitest';

import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import { defined } from '../../../../src/lib/core/document/logic-document';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import type { ChannelEndpoint } from '../../../../src/lib/core/layout/routing/channel-types';
import { channelPoints } from '../../../../src/lib/core/layout/routing/materialize-node-routes';
import { AssertRenderedPaths } from '../../../support/assertions/assert-rendered-paths';
import { AssertRoutes } from '../../../support/assertions/assert-routes';
import { routeCrossings, routeSegments } from '../../../support/assertions/route-geometry';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

function pathsFor(input: readonly ChannelEndpoint[], vertical: boolean) {
	const plan = routeChannel(input);
	const end = (plan.railCount + 1) * 48;
	const paths = plan.wires.map((wire) => ({
		id: wire.id,
		from: wire.sharedSource ?? wire.id,
		to: wire.sharedTarget ?? wire.id,
		points: channelPoints(wire, 0, end, { vertical, railStart: 48, railStep: 48 }),
	}));
	return paths;
}

it('joins arbitrary incoming families without column cycles or unrelated shared segments', () => {
	fc.assert(
		fc.property(
			fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 2, maxLength: 12 }),
			fc.boolean(),
			(targets, vertical) => {
				const input = targets.map((target, source) => ({
					id: `s${source}`,
					source: source * 48,
					target: target * 48,
					sharedTarget: `j${target}`,
				}));
				const routes = pathsFor(input, vertical);
				const junctions = new Set(input.map(({ sharedTarget }) => sharedTarget));
				AssertRoutes(routes).haveOnlyAllowedSharedTrunks(routes, junctions);
				AssertRenderedPaths(renderRelationPaths(routes)).haveBridgeAtEveryCrossing();
				expect(pathsFor(input.toReversed(), vertical)).toEqual(routes.toReversed());
				for (const junction of junctions) {
					const arrivals = routes.filter(({ to }) => to === junction);
					expect(
						new Set(arrivals.map(({ points }) => JSON.stringify(defined(points.at(-1))))),
					).toHaveLength(1);
				}
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('stacks interleaved runs so that neither riser crosses the other traverse', () => {
	fc.assert(
		fc.property(
			fc.tuple(
				fc.integer({ min: 1, max: 5 }),
				fc.integer({ min: 1, max: 5 }),
				fc.integer({ min: 1, max: 5 }),
			),
			fc.boolean(),
			fc.boolean(),
			([first, second, third], leftward, vertical) => {
				const p = 0;
				const q = first * 24;
				const r = (first + second) * 24;
				const s = (first + second + third) * 24;
				let input: ChannelEndpoint[] = [
					{ id: 'outer', source: p, target: r },
					{ id: 'inner', source: q, target: s },
				];
				if (leftward)
					input = [
						{ id: 'outer', source: s, target: q },
						{ id: 'inner', source: r, target: p },
					];
				expect(routeCrossings(pathsFor(input, vertical))).toEqual([]);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('resolves a cycle created by merging different arrivals into two junction traverses', () => {
	const input = [
		{ id: 'a', source: 0, target: 96, sharedTarget: 'j1' },
		{ id: 'b', source: 48, target: 96, sharedTarget: 'j1' },
		{ id: 'c', source: 96, target: 0, sharedTarget: 'j2' },
		{ id: 'd', source: 144, target: 0, sharedTarget: 'j2' },
	];
	const routes = pathsFor(input, true);
	AssertRoutes(routes).haveOnlyAllowedSharedTrunks(routes, new Set(['j1', 'j2']));
	AssertRenderedPaths(renderRelationPaths(routes)).haveBridgeAtEveryCrossing();
});

it('coalesces arbitrary departures without losing the order of their detours', () => {
	fc.assert(
		fc.property(
			fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 2, maxLength: 12 }),
			fc.boolean(),
			(sources, vertical) => {
				const input = sources.map((source, target) => ({
					id: `t${target}`,
					source: source * 48,
					target: target * 48,
					sharedSource: `j${source}`,
				}));
				checkSharing(input, vertical);
				const starts = new Map<string, number>();
				for (const route of pathsFor(input, vertical)) {
					let axis = 'x';
					if (!vertical) axis = 'y';
					const first = routeSegments(route).find((segment) => segment.axis === axis);
					if (first === undefined) continue;
					expect(first.fixed).toBe(starts.get(route.from) ?? first.fixed);
					starts.set(route.from, first.fixed);
				}
			},
		),
		PROPERTY_PARAMETERS,
	);
});

function checkSharing(input: readonly ChannelEndpoint[], vertical: boolean): void {
	const routes = pathsFor(input, vertical);
	const targets = new Set<string>();
	for (const { sharedTarget } of input) if (sharedTarget !== undefined) targets.add(sharedTarget);
	AssertRoutes(routes).haveOnlyAllowedSharedTrunks(routes, targets);
	AssertRenderedPaths(renderRelationPaths(routes)).haveBridgeAtEveryCrossing();
	expect(pathsFor(input.toReversed(), vertical)).toEqual(routes.toReversed());
	for (const route of routes) {
		let previous = 0;
		for (const point of route.points) {
			let next = point.y;
			if (!vertical) next = point.x;
			expect(next).toBeGreaterThanOrEqual(previous);
			previous = next;
		}
	}
}

it('keeps source and destination families separate when both sides contain junctions', () => {
	const edge = fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }));
	fc.assert(
		fc.property(
			fc.uniqueArray(edge, {
				minLength: 2,
				maxLength: 16,
				selector: ([source, target]) => `${source}-${target}`,
			}),
			fc.boolean(),
			(edges, vertical) => {
				const input = edges.map(([source, target]) => ({
					id: `${source}-${target}`,
					source: source * 48,
					target: target * 48,
					sharedSource: `s${source}`,
					sharedTarget: `j${target}`,
				}));
				checkSharing(input, vertical);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('preserves parallel relation identities when both their departure and arrival are shared', () => {
	const input = ['first', 'second'].map((id) => ({
		id,
		source: 0,
		target: 48,
		sharedSource: 'source-junction',
		sharedTarget: 'target-junction',
	}));
	checkSharing(input, true);
	expect(pathsFor(input, true).map(({ id }) => id)).toEqual(['first', 'second']);
});

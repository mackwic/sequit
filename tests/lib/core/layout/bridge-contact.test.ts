import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	disallowedRouteContacts,
	type RouteContact,
	RouteContactKind,
	unbridgedContacts,
} from '../../../../src/lib/core/layout/bridge-contact';
import {
	type LayoutBridge,
	type RoutedPath,
	validatedBridges,
} from '../../../../src/lib/core/layout/bridge-oracle';
import { DedicatedCandidateRejectionCode } from '../../../../src/lib/core/layout/dedicated-candidate-validation';
import { contactFailure } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-contacts';
import type { LayoutRelation, Point } from '../../../../src/lib/core/layout/layout-types';
import { validateSharedLaneRouteContacts } from '../../../../src/lib/core/layout/shared-lane-route-contact-validation';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

function path(id: string, ...coordinates: readonly [number, number][]): RoutedPath {
	return { id, points: coordinates.map(([x, y]) => ({ x, y })) };
}

const point = (x: number, y: number): RouteContact => ({
	kind: RouteContactKind.Point,
	from: { x, y },
	to: { x, y },
});
const overlap = (from: Point, to: Point): RouteContact => ({
	kind: RouteContactKind.Overlap,
	from,
	to,
});

function along(point: Point, vertical: boolean): number {
	if (vertical) return point.y;
	return point.x;
}

/** Reference geometry reads waypoint segments, not the production run/contact helpers. */
function referenceContacts(
	first: RoutedPath,
	second: RoutedPath,
	bridges: readonly LayoutBridge[],
): readonly RouteContact[] {
	const contacts: RouteContact[] = [];
	for (let i = 1; i < first.points.length; i += 1)
		for (let j = 1; j < second.points.length; j += 1) {
			const a = first.points[i - 1];
			const b = first.points[i];
			const c = second.points[j - 1];
			const d = second.points[j];
			if (a === undefined || b === undefined || c === undefined || d === undefined)
				throw new Error('Incomplete generated path');
			const av = a.x === b.x;
			const cv = c.x === d.x;
			if (av === cv) {
				if (av && a.x !== c.x) continue;
				if (!av && a.y !== c.y) continue;
				const low = Math.max(
					Math.min(along(a, av), along(b, av)),
					Math.min(along(c, cv), along(d, cv)),
				);
				const high = Math.min(
					Math.max(along(a, av), along(b, av)),
					Math.max(along(c, cv), along(d, cv)),
				);
				if (low > high) continue;
				if (av) {
					if (low === high) contacts.push(point(a.x, low));
					else contacts.push(overlap({ x: a.x, y: low }, { x: a.x, y: high }));
				} else if (low === high) contacts.push(point(low, a.y));
				else contacts.push(overlap({ x: low, y: a.y }, { x: high, y: a.y }));
				continue;
			}
			let vertical = [c, d];
			let horizontal = [a, b];
			if (av) {
				vertical = [a, b];
				horizontal = [c, d];
			}
			const [vStart, vEnd] = vertical;
			const [hStart, hEnd] = horizontal;
			if (vStart === undefined || vEnd === undefined || hStart === undefined || hEnd === undefined)
				throw new Error('Incomplete generated segment');
			const x = vStart.x;
			const y = hStart.y;
			const hLow = Math.min(hStart.x, hEnd.x);
			const hHigh = Math.max(hStart.x, hEnd.x);
			const vLow = Math.min(vStart.y, vEnd.y);
			const vHigh = Math.max(vStart.y, vEnd.y);
			if (x < hLow || x > hHigh || y < vLow || y > vHigh) continue;
			const isStrict = x > hLow && x < hHigh && y > vLow && y < vHigh;
			const bridged =
				isStrict &&
				bridges.some(
					(bridge) =>
						bridge.x === x &&
						bridge.y === y &&
						((bridge.carrierIds.includes(first.id) && bridge.crossedIds.includes(second.id)) ||
							(bridge.carrierIds.includes(second.id) && bridge.crossedIds.includes(first.id))),
				);
			if (!bridged) contacts.push(point(x, y));
		}
	const unique = new Map<string, RouteContact>();
	for (const contact of contacts) unique.set(JSON.stringify(contact), contact);
	const distinct = [...unique.values()];
	return distinct
		.filter(
			(contact) =>
				contact.kind === RouteContactKind.Overlap ||
				!distinct.some(
					(other) =>
						other.kind === RouteContactKind.Overlap &&
						contact.from.x >= other.from.x &&
						contact.from.x <= other.to.x &&
						contact.from.y >= other.from.y &&
						contact.from.y <= other.to.y,
				),
		)
		.sort(
			(a, b) => a.from.x - b.from.x || a.from.y - b.from.y || a.to.x - b.to.x || a.to.y - b.to.y,
		);
}

const coordinate = fc.integer({ min: 0, max: 60 });
const generatedRoute = fc
	.tuple(
		coordinate,
		coordinate,
		fc.integer({ min: 1, max: 60 }),
		fc.integer({ min: 1, max: 60 }),
		fc.boolean(),
		fc.boolean(),
	)
	.map(([x, y, dx, dy, verticalFirst, reverse]) => {
		let points = [
			{ x, y },
			{ x: x + dx, y },
			{ x: x + dx, y: y + dy },
		];
		if (verticalFirst)
			points = [
				{ x, y },
				{ x, y: y + dy },
				{ x: x + dx, y: y + dy },
			];
		if (reverse) return points.toReversed();
		return points;
	});

describe('one route-contact rule', () => {
	it('distinguishes bridgeable strict crossings, T-contacts, overlaps, and endpoint-only attachment', () => {
		const horizontal = path('h', [0, 50], [100, 50]);
		const vertical = path('v', [50, 0], [50, 100]);
		const bridge = validatedBridges([horizontal, vertical]);
		expect(bridge).toHaveLength(1);
		expect(disallowedRouteContacts(horizontal, vertical, bridge)).toEqual([]);
		expect(disallowedRouteContacts(horizontal, vertical, [])).toEqual([point(50, 50)]);
		expect(disallowedRouteContacts(horizontal, path('t', [50, 0], [50, 50]), bridge)).toEqual([
			point(50, 50),
		]);
		expect(disallowedRouteContacts(horizontal, path('short', [50, 40], [50, 60]), [])).toEqual([
			point(50, 50),
		]);
		expect(disallowedRouteContacts(horizontal, path('o', [20, 50], [80, 50]), bridge)).toEqual([
			overlap({ x: 20, y: 50 }, { x: 80, y: 50 }),
		]);
		const outgoing = { ...path('out', [0, 0], [0, 50]), from: 'node' };
		const arriving = { ...path('in', [-50, 0], [0, 0]), to: 'node' };
		expect(disallowedRouteContacts(outgoing, arriving, [])).toEqual([]);
		expect(disallowedRouteContacts(outgoing, { ...arriving, to: 'other' }, [])).toEqual([
			point(0, 0),
		]);
	});

	it('rejects overlap from an attachment unless the same family shares a continuous trunk', () => {
		const first = { ...path('first', [0, 0], [100, 0], [100, 50]), from: 'node', to: 'one' };
		const shared = { ...path('shared', [0, 0], [40, 0], [40, 50]), from: 'node', to: 'two' };
		expect(disallowedRouteContacts(first, shared, [])).toEqual([]);
		expect(disallowedRouteContacts(first, { ...shared, from: 'other' }, [])).toEqual([
			overlap({ x: 0, y: 0 }, { x: 40, y: 0 }),
		]);
		const rejoined = {
			...path('rejoined', [0, 0], [40, 0], [40, 20], [80, 20], [80, 0], [100, 0]),
			from: 'node',
			to: 'two',
		};
		expect(disallowedRouteContacts(first, rejoined, [])).toEqual([
			overlap({ x: 80, y: 0 }, { x: 100, y: 0 }),
		]);
	});

	it('gives dedicated and lane validators the same typed refusal and canonical relation pair', () => {
		const a: LayoutRelation = { ...path('a', [0, 0], [50, 0]), from: 'one', to: 'two' };
		const z: LayoutRelation = { ...path('z', [0, 0], [20, 0]), from: 'another', to: 'three' };
		const analysis = { crossings: [], bridges: [] };
		expect(contactFailure([a, z], analysis)).toMatchObject({
			valid: false,
			code: DedicatedCandidateRejectionCode.RouteContact,
			relationId: 'a',
			otherRelationId: 'z',
			contact: { x: 0, y: 0 },
		});
		for (const routes of [
			[a, z],
			[z, a],
		]) {
			expect(validateSharedLaneRouteContacts(routes, false)).toBe(
				'Routes a and z cross without a bridge.',
			);
			expect(validateSharedLaneRouteContacts(routes, true)).toBe(
				'Routes a and z cross without a bridge.',
			);
		}
	});

	it('agrees with an independent segment oracle under route permutation', () => {
		fc.assert(
			fc.property(generatedRoute, generatedRoute, (a, b) => {
				const first: RoutedPath = { id: 'a', points: a };
				const second: RoutedPath = { id: 'b', points: b };
				const expected = unbridgedContacts(first, second, validatedBridges([first, second]));
				for (const routes of [
					[first, second],
					[second, first],
				] as const) {
					const bridges = validatedBridges(routes);
					const left = routes[0];
					const right = routes[1];
					expect(unbridgedContacts(left, right, bridges)).toEqual(expected);
					expect(unbridgedContacts(left, right, bridges)).toEqual(
						referenceContacts(left, right, bridges),
					);
					expect(unbridgedContacts(left, right, [])).toEqual(referenceContacts(left, right, []));
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});
});

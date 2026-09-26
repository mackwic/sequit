import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	disallowedProvisionalRouteContacts,
	disallowedRouteContacts,
	type RouteContact,
	RouteContactKind,
	unbridgedContacts,
	unbridgedCrossings,
} from '../../../../src/lib/core/layout/bridges/bridge-contact';
import {
	type LayoutBridge,
	routeBridgeAnalysis,
	type RoutedPath,
	validatedBridges,
} from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { contactFailure } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-contacts';
import { DedicatedCandidateRejectionCode } from '../../../../src/lib/core/layout/dedicated-candidate-validation/types';
import { validateSharedLaneRouteContacts } from '../../../../src/lib/core/layout/lanes/shared-lane-route-contact-validation';
import type { LayoutRelation, Point } from '../../../../src/lib/core/layout/layout-types';
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

interface ReferenceSpan {
	readonly start: Point;
	end: Point;
}

/** Coalesce forward, collinear waypoint stretches without reading the production run helpers. */
function referenceSpans(points: readonly Point[]): readonly ReferenceSpan[] {
	const spans: ReferenceSpan[] = [];
	for (let index = 1; index < points.length; index += 1) {
		const start = points[index - 1];
		const end = points[index];
		if (start === undefined || end === undefined) throw new Error('Incomplete generated path');
		const prior = spans.at(-1);
		if (prior?.end.x === start.x && prior.end.y === start.y) {
			const vertical = prior.start.x === prior.end.x;
			let priorStep = prior.end.x - prior.start.x;
			let nextStep = end.x - start.x;
			let aligned = end.y === start.y;
			if (vertical) {
				priorStep = prior.end.y - prior.start.y;
				nextStep = end.y - start.y;
				aligned = end.x === start.x;
			}
			if (aligned && Math.sign(priorStep) === Math.sign(nextStep)) {
				prior.end = end;
				continue;
			}
		}
		spans.push({ start, end });
	}
	return spans;
}

/** Reference geometry reads independently coalesced waypoint spans, not production helpers. */
function referenceContacts(
	first: RoutedPath,
	second: RoutedPath,
	bridges: readonly LayoutBridge[],
): readonly RouteContact[] {
	const contacts: RouteContact[] = [];
	const secondSpans = referenceSpans(second.points);
	for (const { start: a, end: b } of referenceSpans(first.points))
		for (const { start: c, end: d } of secondSpans) {
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
		fc.boolean(),
		fc.boolean(),
	)
	.map(([x, y, dx, dy, verticalFirst, reverse, splitFirst, splitLast]) => {
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
		if (splitFirst) {
			const first = points[0];
			const next = points[1];
			if (first === undefined || next === undefined) throw new Error('Incomplete generated path');
			points.splice(1, 0, { x: (first.x + next.x) / 2, y: (first.y + next.y) / 2 });
		}
		if (splitLast) {
			const last = points.at(-1);
			const previous = points.at(-2);
			if (last === undefined || previous === undefined)
				throw new Error('Incomplete generated path');
			points.splice(points.length - 1, 0, {
				x: (previous.x + last.x) / 2,
				y: (previous.y + last.y) / 2,
			});
		}
		if (reverse) return points.toReversed();
		return points;
	});

describe('one route-contact rule', () => {
	it('treats straight-through waypoints at a bridge as one route run', () => {
		const horizontal = path('h', [0, 50], [50, 50], [100, 50]);
		const vertical = path('v', [50, 0], [50, 50], [50, 100]);
		const bridges = validatedBridges([horizontal, vertical]);
		expect(bridges).toHaveLength(1);
		expect(unbridgedContacts(horizontal, vertical, bridges)).toEqual([]);
		expect(referenceContacts(horizontal, vertical, bridges)).toEqual([]);
	});

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

	it('defers only strict crossings of a portal piece to the fully assembled route', () => {
		const short = path('short', [135, 8], [145, 8]);
		const piece = path('incident', [140, 60], [140, 0]);
		const full = path('incident', [140, 60], [140, 0], [140, -32]);
		expect(validatedBridges([short, piece])).toEqual([]);
		expect(disallowedRouteContacts(short, piece, [])).toEqual([point(140, 8)]);
		expect(disallowedProvisionalRouteContacts(short, piece)).toEqual([]);
		expect(validatedBridges([short, full])).toHaveLength(1);
		expect(disallowedRouteContacts(short, full, validatedBridges([short, full]))).toEqual([]);
		expect(
			disallowedProvisionalRouteContacts(short, path('incident', [140, 60], [140, 8])),
		).toEqual([point(140, 8)]);
		expect(disallowedProvisionalRouteContacts(path('overlap', [135, 8], [145, 8]), short)).toEqual([
			overlap({ x: 135, y: 8 }, { x: 145, y: 8 }),
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

	it('does not confuse a later validated bridge with a closer unbridgeable crossing', () => {
		const shortHorizontal = path('short-h', [40, 50], [60, 50]);
		const shortVertical = path('short-v', [50, 40], [50, 60]);
		const laterHorizontal = path('later-h', [50, 80], [100, 80]);
		const laterVertical = path('later-v', [75, 60], [75, 100]);
		const bridges = validatedBridges([
			shortHorizontal,
			shortVertical,
			laterHorizontal,
			laterVertical,
		]);
		expect(bridges).toHaveLength(1);
		expect(bridges[0]).toMatchObject({ x: 75, y: 80 });
		expect(
			unbridgedContacts(shortHorizontal, shortVertical, bridges, { sortedByPoint: true }),
		).toEqual([point(50, 50)]);
		expect(
			unbridgedContacts(laterHorizontal, laterVertical, bridges, { sortedByPoint: true }),
		).toEqual([]);
	});

	it('preserves uncovered route pairs with unsorted bridges at the same point', () => {
		const atPoint = { x: 50, y: 50 };
		const crossings = [
			{ ...atPoint, horizontalId: 'h', verticalId: 'v' },
			{ ...atPoint, horizontalId: 'other', verticalId: 'v' },
		];
		const bridges = [
			{ x: 100, y: 100, carrierIds: ['other'], crossedIds: ['v'] },
			{ ...atPoint, carrierIds: ['h'], crossedIds: ['v'] },
		];
		expect(unbridgedCrossings({ crossings, bridges })).toEqual([crossings[1]]);
		expect(unbridgedCrossings({ crossings, bridges: bridges.toReversed() })).toEqual([
			crossings[1],
		]);
	});

	it('gives dedicated and lane validators the same typed refusal and canonical relation pair', () => {
		const a: LayoutRelation = { ...path('a', [0, 0], [50, 0]), from: 'one', to: 'two' };
		const z: LayoutRelation = { ...path('z', [0, 0], [20, 0]), from: 'another', to: 'three' };
		const analysis = routeBridgeAnalysis([a, z]);
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

import { defined } from '../document/logic-document';
import {
	type EndpointRoute,
	sharedAtEndpoint,
	sharedAttachmentPoint,
} from './bridge-contact-shared';
import {
	type LayoutBridge,
	type RouteBridgeAnalysis,
	type RouteCrossing,
	type RoutedPath,
	RouteOrientation,
	type RouteRun,
	routeRuns,
	type RouteWorkCharge,
	runInterval,
} from './bridge-oracle';
import type { Point } from './layout-types';
import { samePoint } from './nested-region-geometry-primitives';

export type { EndpointRoute } from './bridge-contact-shared';

/** True when a validated bridge carries the contact point between the two declared paths. */
function bridgeCovers(
	bridge: LayoutBridge,
	point: Point,
	firstId: string,
	secondId: string,
): boolean {
	if (!samePoint(bridge, point)) return false;
	const forward = bridge.carrierIds.includes(firstId) && bridge.crossedIds.includes(secondId);
	const backward = bridge.carrierIds.includes(secondId) && bridge.crossedIds.includes(firstId);
	return forward || backward;
}

function chargeBridgeCoverage(bridge: LayoutBridge, charge: RouteWorkCharge | undefined): void {
	if (charge === undefined) return;
	const routeIds = bridge.carrierIds.length + bridge.crossedIds.length;
	charge(1 + 2 * routeIds);
}

/** The crossings of an analysis that no validated bridge of the same analysis covers. */
export function unbridgedCrossings(analysis: RouteBridgeAnalysis): readonly RouteCrossing[] {
	return analysis.crossings.filter(
		(crossing) =>
			!analysis.bridges.some((bridge) =>
				bridgeCovers(bridge, crossing, crossing.horizontalId, crossing.verticalId),
			),
	);
}

export enum RouteContactKind {
	Point = 'point',
	Overlap = 'overlap',
}

/** Point contacts and positive-length collinear overlaps have different exemptions. */
export interface RouteContact {
	readonly kind: RouteContactKind;
	readonly from: Point;
	readonly to: Point;
}

function runContact(first: RouteRun, second: RouteRun): RouteContact | undefined {
	const left = runInterval(first);
	const right = runInterval(second);
	if (first.orientation === second.orientation) {
		if (left.fixed !== right.fixed) return undefined;
		const low = Math.max(left.low, right.low);
		const high = Math.min(left.high, right.high);
		if (low > high) return undefined;
		let from = { x: low, y: left.fixed };
		let to = { x: high, y: left.fixed };
		if (first.orientation === RouteOrientation.Vertical) {
			from = { x: left.fixed, y: low };
			to = { x: left.fixed, y: high };
		}
		let kind = RouteContactKind.Overlap;
		if (low === high) kind = RouteContactKind.Point;
		return { kind, from, to };
	}
	const firstInside = right.fixed >= left.low && right.fixed <= left.high;
	const secondInside = left.fixed >= right.low && left.fixed <= right.high;
	if (!firstInside || !secondInside) return undefined;
	let point = { x: right.fixed, y: left.fixed };
	if (first.orientation === RouteOrientation.Vertical) point = { x: left.fixed, y: right.fixed };
	return { kind: RouteContactKind.Point, from: point, to: point };
}

function strictRunCrossing(first: RouteRun, second: RouteRun, point: Point): boolean {
	if (first.orientation === second.orientation) return false;
	const left = runInterval(first);
	const right = runInterval(second);
	let firstCoordinate = point.y;
	let secondCoordinate = point.y;
	if (first.orientation === RouteOrientation.Horizontal) firstCoordinate = point.x;
	if (second.orientation === RouteOrientation.Horizontal) secondCoordinate = point.x;
	const firstInside = firstCoordinate > left.low && firstCoordinate < left.high;
	const secondInside = secondCoordinate > right.low && secondCoordinate < right.high;
	return firstInside && secondInside;
}

function compareContacts(first: RouteContact, second: RouteContact): number {
	const x = first.from.x - second.from.x;
	const y = first.from.y - second.from.y;
	const extentX = first.to.x - second.to.x;
	const extentY = first.to.y - second.to.y;
	return x || y || extentX || extentY;
}

/** The first bridge at or beyond one point in the oracle's x/y-sorted bridge array. */
function firstBridgeAtPoint(
	bridges: readonly LayoutBridge[],
	point: Point,
	charge?: RouteWorkCharge,
): number {
	let low = 0;
	let high = bridges.length;
	while (low < high) {
		charge?.(1);
		const middle = low + Math.floor((high - low) / 2);
		const bridge = defined(bridges[middle]);
		const beforeX = bridge.x < point.x;
		const beforeY = bridge.x === point.x && bridge.y < point.y;
		if (beforeX || beforeY) low = middle + 1;
		else high = middle;
	}
	return low;
}

export interface BridgeContactOptions {
	readonly charge?: RouteWorkCharge | undefined;
	/** The canonical x/y order returned by `validatedBridges` is guaranteed. */
	readonly sortedByPoint: true;
}

interface BridgeContactLookup {
	readonly bridges: readonly LayoutBridge[];
	readonly firstId: string;
	readonly secondId: string;
	readonly charge: RouteWorkCharge | undefined;
	readonly sortedByPoint: boolean;
}

function contactIsBridged(point: Point, lookup: BridgeContactLookup): boolean {
	const { bridges, firstId, secondId, charge, sortedByPoint } = lookup;
	let index = 0;
	if (sortedByPoint) index = firstBridgeAtPoint(bridges, point, charge);
	for (; index < bridges.length; index += 1) {
		const bridge = defined(bridges[index]);
		if (sortedByPoint && !samePoint(bridge, point)) break;
		chargeBridgeCoverage(bridge, charge);
		if (bridgeCovers(bridge, point, firstId, secondId)) return true;
	}
	return false;
}

function contactInsideOverlap(contact: RouteContact, other: RouteContact): boolean {
	if (other.kind !== RouteContactKind.Overlap) return false;
	const x = contact.from.x >= other.from.x && contact.from.x <= other.to.x;
	const y = contact.from.y >= other.from.y && contact.from.y <= other.to.y;
	return x && y;
}

/** All unbridged contacts, in canonical coordinate order regardless of route or run order. */
export function unbridgedContacts(
	first: RoutedPath,
	second: RoutedPath,
	bridges: readonly LayoutBridge[],
	options?: BridgeContactOptions,
): readonly RouteContact[] {
	const charge = options?.charge;
	const sortedByPoint = options?.sortedByPoint ?? false;
	const lookup = { bridges, firstId: first.id, secondId: second.id, charge, sortedByPoint };
	const contacts = new Map<string, RouteContact>();
	const secondRuns = routeRuns(second, charge);
	for (const firstRun of routeRuns(first, charge)) {
		for (const secondRun of secondRuns) {
			charge?.(1);
			const contact = runContact(firstRun, secondRun);
			if (contact === undefined) continue;
			const canBridge = bridges.length > 0 && contact.kind === RouteContactKind.Point;
			if (
				canBridge &&
				strictRunCrossing(firstRun, secondRun, contact.from) &&
				contactIsBridged(contact.from, lookup)
			)
				continue;
			const { from, to } = contact;
			contacts.set(`${from.x}:${from.y}:${to.x}:${to.y}`, contact);
		}
	}
	if (contacts.size === 0) return [];
	const ordered = [...contacts.values()].sort(compareContacts);
	if (ordered.every((contact) => contact.kind === RouteContactKind.Point)) return ordered;
	return ordered.filter(
		(contact) =>
			contact.kind === RouteContactKind.Overlap ||
			!ordered.some((other) => contactInsideOverlap(contact, other)),
	);
}

/** An attachment point is allowed, but an extent needs a continuous shared family trunk. */
export function permittedRouteContact(
	first: EndpointRoute,
	second: EndpointRoute,
	contact: RouteContact,
): boolean {
	const sharedSource =
		sharedAtEndpoint(first, second, contact.from, true) &&
		sharedAtEndpoint(first, second, contact.to, true);
	const sharedTarget =
		sharedAtEndpoint(first, second, contact.from, false) &&
		sharedAtEndpoint(first, second, contact.to, false);
	if (sharedSource || sharedTarget) return true;
	if (contact.kind === RouteContactKind.Overlap) return false;
	return sharedAttachmentPoint(first, second, contact.from);
}

/** One canonical policy shared by dedicated, lane and leaf candidate validators. */
export function disallowedRouteContacts(
	first: EndpointRoute,
	second: EndpointRoute,
	bridges: readonly LayoutBridge[],
	options?: BridgeContactOptions,
): readonly RouteContact[] {
	const contacts = unbridgedContacts(first, second, bridges, options);
	if (contacts.length === 0) return contacts;
	return contacts.filter((contact) => !permittedRouteContact(first, second, contact));
}

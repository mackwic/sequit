import { defined } from '../../document/logic-document';
import { samePoint } from '../geometry/nested-region-geometry-primitives';
import type { Point } from '../layout-types';
import {
	type EndpointRoute,
	sharedAtEndpoint,
	sharedAttachmentPoint,
	type SharedRouteRuns,
} from './bridge-contact-shared';
import type { LayoutBridge, RouteBridgeAnalysis, RouteCrossing } from './bridge-oracle';
import {
	type RoutedPath,
	RouteOrientation,
	type RouteRun,
	routeRuns,
	type RouteWorkCharge,
	runInterval,
} from './route-runs';

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
export function unbridgedCrossings(analysis: {
	readonly crossings: RouteBridgeAnalysis['crossings'];
	readonly bridges: RouteBridgeAnalysis['bridges'];
}): readonly RouteCrossing[] {
	const bridgesByPoint = new Map<string, LayoutBridge[]>();
	for (const bridge of analysis.bridges) {
		const key = `${bridge.x}:${bridge.y}`;
		let atPoint = bridgesByPoint.get(key);
		if (atPoint === undefined) {
			atPoint = [];
			bridgesByPoint.set(key, atPoint);
		}
		atPoint.push(bridge);
	}
	return analysis.crossings.filter(
		(crossing) =>
			!(bridgesByPoint.get(`${crossing.x}:${crossing.y}`) ?? []).some((bridge) =>
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

enum ContactScanMode {
	Provisional = 'provisional',
}

interface BridgeContactLookup {
	readonly bridges: readonly LayoutBridge[];
	readonly firstId: string;
	readonly secondId: string;
	readonly charge: RouteWorkCharge | undefined;
	readonly sortedByPoint: boolean;
	readonly deferBridgeDecision: boolean;
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

function bridgeOrProvisionalContact(
	firstRun: RouteRun,
	secondRun: RouteRun,
	contact: RouteContact,
	lookup: BridgeContactLookup,
): boolean {
	if (contact.kind !== RouteContactKind.Point) return false;
	if (!lookup.deferBridgeDecision && lookup.bridges.length === 0) return false;
	if (!strictRunCrossing(firstRun, secondRun, contact.from)) return false;
	return lookup.deferBridgeDecision || contactIsBridged(contact.from, lookup);
}

function contactInsideOverlap(contact: RouteContact, other: RouteContact): boolean {
	if (other.kind !== RouteContactKind.Overlap) return false;
	const x = contact.from.x >= other.from.x && contact.from.x <= other.to.x;
	const y = contact.from.y >= other.from.y && contact.from.y <= other.to.y;
	return x && y;
}

interface ContactScanOptions {
	readonly bridges: BridgeContactOptions | undefined;
	readonly mode?: ContactScanMode;
	readonly runs?: SharedRouteRuns;
}

/** Collects the same contacts for complete and still-to-be-extended leaf routes. */
function routeContacts(
	first: RoutedPath,
	second: RoutedPath,
	bridges: readonly LayoutBridge[],
	options: ContactScanOptions,
): readonly RouteContact[] {
	const bridgeOptions = options.bridges;
	const deferBridgeDecision = options.mode === ContactScanMode.Provisional;
	const charge = bridgeOptions?.charge;
	const sortedByPoint = bridgeOptions?.sortedByPoint ?? false;
	const lookup = {
		bridges,
		firstId: first.id,
		secondId: second.id,
		charge,
		sortedByPoint,
		deferBridgeDecision,
	};
	const contacts = new Map<string, RouteContact>();
	const secondRuns = options.runs?.second ?? routeRuns(second, charge);
	const firstRuns = options.runs?.first ?? routeRuns(first, charge);
	for (const firstRun of firstRuns) {
		for (const secondRun of secondRuns) {
			charge?.(1);
			const contact = runContact(firstRun, secondRun);
			if (contact === undefined) continue;
			if (bridgeOrProvisionalContact(firstRun, secondRun, contact, lookup)) continue;
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

/** All unbridged contacts of complete routes, canonically ordered. */
export function unbridgedContacts(
	first: RoutedPath,
	second: RoutedPath,
	bridges: readonly LayoutBridge[],
	options?: BridgeContactOptions,
): readonly RouteContact[] {
	return routeContacts(first, second, bridges, { bridges: options });
}

/** An attachment point is allowed, but an extent needs a continuous shared family trunk. */
function permittedRouteContact(
	first: EndpointRoute,
	second: EndpointRoute,
	contact: RouteContact,
	runs: SharedRouteRuns,
): boolean {
	const sharedSource =
		sharedAtEndpoint(first, second, contact.from, { from: true, runs }) &&
		sharedAtEndpoint(first, second, contact.to, { from: true, runs });
	const sharedTarget =
		sharedAtEndpoint(first, second, contact.from, { from: false, runs }) &&
		sharedAtEndpoint(first, second, contact.to, { from: false, runs });
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
	const runs = {
		first: routeRuns(first, options?.charge),
		second: routeRuns(second, options?.charge),
	};
	const contacts = routeContacts(first, second, bridges, { bridges: options, runs });
	if (contacts.length === 0) return contacts;
	return contacts.filter((contact) => !permittedRouteContact(first, second, contact, runs));
}

/**
 * A leaf incident ends at a portal; only the assembled relation can prove carrier clearance.
 * Defer strict crossings, never overlaps or T-contacts, to that complete-candidate validator.
 */
export function disallowedProvisionalRouteContacts(
	first: EndpointRoute,
	second: EndpointRoute,
): readonly RouteContact[] {
	const runs = { first: routeRuns(first), second: routeRuns(second) };
	const contacts = routeContacts(first, second, [], {
		bridges: undefined,
		mode: ContactScanMode.Provisional,
		runs,
	});
	if (contacts.length === 0) return contacts;
	return contacts.filter((contact) => !permittedRouteContact(first, second, contact, runs));
}

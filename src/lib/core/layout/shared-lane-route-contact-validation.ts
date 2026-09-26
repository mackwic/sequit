import { defined } from '../document/logic-document';
import { type BridgeContactOptions, unbridgedContacts } from './bridge-contact';
import { type LayoutBridge, type RouteWorkCharge, validatedBridges } from './bridge-oracle';
import type { LayoutRelation } from './layout-types';
import { segmentsContact } from './shared-lane-geometry-primitives';

function routesCross(a: LayoutRelation, b: LayoutRelation, charge?: RouteWorkCharge): boolean {
	for (let first = 1; first < a.points.length; first += 1) {
		const aStart = defined(a.points[first - 1]);
		const aEnd = defined(a.points[first]);
		for (let second = 1; second < b.points.length; second += 1) {
			const bStart = defined(b.points[second - 1]);
			const bEnd = defined(b.points[second]);
			charge?.(1);
			if (segmentsContact(aStart, aEnd, bStart, bEnd)) return true;
		}
	}
	return false;
}

/** Accept contacts only when every one is a strict crossing carried by a validated bridge. */
export function validateSharedLaneRouteContacts(
	routes: readonly LayoutRelation[],
	acceptBridges: boolean,
	charge?: RouteWorkCharge,
	onBridgeCount?: (count: number) => void,
): string | undefined {
	let bridges: readonly LayoutBridge[] | undefined;
	let bridgeOptions: BridgeContactOptions | undefined;
	if (acceptBridges) {
		bridges = validatedBridges(routes, charge);
		bridgeOptions = { charge, sortedByPoint: true };
	}
	for (let first = 0; first < routes.length; first += 1) {
		const a = defined(routes[first]);
		for (let second = first + 1; second < routes.length; second += 1) {
			const b = defined(routes[second]);
			let touching: boolean;
			if (bridges === undefined) touching = routesCross(a, b, charge);
			else touching = unbridgedContacts(a, b, bridges, bridgeOptions).length > 0;
			if (touching) return `Routes ${a.id} and ${b.id} cross without a bridge.`;
		}
	}
	onBridgeCount?.(bridges?.length ?? 0);
	return undefined;
}

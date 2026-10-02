import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import { type BridgeContactOptions, disallowedRouteContacts } from '../bridges/bridge-contact';
import { type LayoutBridge, validatedBridges } from '../bridges/bridge-oracle';
import type { RouteWorkCharge } from '../bridges/route-runs';
import type { LayoutRelation } from '../layout-types';

/** Accept contacts only when every one is a strict crossing carried by a validated bridge. */
export function validateSharedLaneRouteContacts(
	routes: readonly LayoutRelation[],
	acceptBridges: boolean,
	charge?: RouteWorkCharge,
	onBridgeCount?: (count: number) => void,
): string | undefined {
	let bridges: readonly LayoutBridge[] | undefined;
	const bridgeOptions: BridgeContactOptions = { charge, sortedByPoint: true };
	if (acceptBridges) {
		bridges = validatedBridges(routes, charge);
	}
	let ordered = routes;
	if (routes.length > 1) ordered = [...routes].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	for (let first = 0; first < ordered.length; first += 1) {
		const a = defined(ordered[first]);
		for (let second = first + 1; second < ordered.length; second += 1) {
			const b = defined(ordered[second]);
			const touching = disallowedRouteContacts(a, b, bridges ?? [], bridgeOptions).length > 0;
			if (touching) return `Routes ${a.id} and ${b.id} cross without a bridge.`;
		}
	}
	onBridgeCount?.(bridges?.length ?? 0);
	return undefined;
}

/** Contact participants for local main-face and mixed-face port-group rejection. */
export function rejectedSharedLaneRouteContacts(
	routes: readonly LayoutRelation[],
	acceptBridges: boolean,
): ReadonlySet<string> {
	const rejected = new Set<string>();
	let bridges: readonly LayoutBridge[] = [];
	if (acceptBridges) bridges = validatedBridges(routes);
	for (let first = 0; first < routes.length; first += 1) {
		const a = defined(routes[first]);
		for (let second = first + 1; second < routes.length; second += 1) {
			const b = defined(routes[second]);
			if (disallowedRouteContacts(a, b, bridges, { sortedByPoint: true }).length === 0) continue;
			rejected.add(a.id);
			rejected.add(b.id);
		}
	}
	return rejected;
}

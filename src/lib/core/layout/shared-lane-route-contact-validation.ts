import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { type BridgeContactOptions, disallowedRouteContacts } from './bridge-contact';
import { type LayoutBridge, type RouteWorkCharge, validatedBridges } from './bridge-oracle';
import type { LayoutRelation } from './layout-types';

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

import { LayoutPolicy, type LogicDocument } from '../document/logic-document';
import type { RegionDefinition } from './region-composition-types';

/** Use the persisted region policy; only older derived inputs need a presentation fallback. */
export function regionLeafPolicy(definition: Partial<RegionDefinition>): LayoutPolicy {
	if (definition.policy !== undefined) return definition.policy;
	if (definition.lanePresentation !== undefined) return LayoutPolicy.SharedLanes;
	return LayoutPolicy.Layered;
}

/** Reject a caller/configuration disagreement before either leaf policy can read the cache. */
export function regionLeafPolicyFailure(
	leafPolicy: LayoutPolicy,
	document: LogicDocument,
): string | undefined {
	if (leafPolicy === LayoutPolicy.Layered) {
		if (document.presentation === undefined) return undefined;
		return 'A layered region leaf cannot have a lane presentation.';
	}
	if (document.presentation !== undefined) return undefined;
	return 'A shared-lane region leaf requires a lane presentation.';
}

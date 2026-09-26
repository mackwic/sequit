import { LayoutPolicy, type LogicDocument } from '../../../document/logic-document';
import type { RegionDefinition } from '../model/region-composition-types';

/** Dispatch only on the policy materialized by region normalization. */
export function regionLeafPolicy(definition: RegionDefinition): LayoutPolicy {
	return definition.policy;
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

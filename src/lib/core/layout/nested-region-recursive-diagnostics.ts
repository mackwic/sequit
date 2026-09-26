import { defined } from '../document/logic-document';
import { regionArrangementFor } from './region-arrangement-selection';
import type { RegionCompositionModel } from './region-composition-model';
import {
	type RegionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from './region-geometry-diagnostic';
import { RegionIncidentRejectionCode, RegionIncidentUnknownCode } from './region-incident-contract';
import { type RegionSearchEvidence, RegionSearchProvenance } from './region-search-evidence';

const RETRYABLE_INCIDENT_CODES = new Set([
	RegionGeometryDiagnosticCode.ParentRouteContact,
	RegionGeometryDiagnosticCode.IncidentCrossesForeignNode,
	RegionGeometryDiagnosticCode.IncidentTouchesLocalRelation,
	RegionGeometryDiagnosticCode.IncidentWrongAttachment,
]);

export function regionQualifiedFailure(
	model: RegionCompositionModel,
	failure: RegionGeometryDiagnostic,
): string {
	if (
		failure.code === RegionGeometryDiagnosticCode.LocalRelationMissing ||
		failure.code === RegionGeometryDiagnosticCode.LocalRelationNonOrthogonal
	)
		return failure.message;
	const owner = model.relations.find(({ relation }) => relation.id === failure.relationId)?.ownerId;
	if (owner === undefined || owner === model.rootId) return failure.message;
	return `Region ${owner}: ${failure.message}`;
}

/** Only an arrangement that declares alternate sides can own a retry. */
function retryableOwner(model: RegionCompositionModel, ownerId: string): string | undefined {
	// Every relation owner comes from `relationOwnership`'s least common ancestor, so the
	// normalized model always holds the region for an owner identifier read from `model.relations`.
	const owner = defined(model.regionsById.get(ownerId));
	const arrangement = regionArrangementFor(owner);
	if (arrangement === undefined || arrangement.alternativeSides.length === 0) return undefined;
	return ownerId;
}

export function retryOwnerForIncidentFailure(
	model: RegionCompositionModel,
	failure: RegionGeometryDiagnostic,
): string | undefined {
	if (!RETRYABLE_INCIDENT_CODES.has(failure.code)) return undefined;
	const owned = model.relations.find(({ relation }) => relation.id === failure.relationId);
	const ownerId = owned?.ownerId;
	if (ownerId === undefined) return undefined;
	return retryableOwner(model, ownerId);
}

/** A rejected leaf route may be resolved by one alternate side of its owning row. */
export function retryOwnerForLeafContractFailure(
	model: RegionCompositionModel,
	evidence: RegionSearchEvidence | undefined,
): string | undefined {
	if (
		evidence?.provenance !== RegionSearchProvenance.Incident ||
		evidence.code !== RegionIncidentUnknownCode.NoValidAlternative
	)
		return undefined;
	for (const rejected of evidence.witness.rejectedAlternatives) {
		if (rejected.code !== RegionIncidentRejectionCode.RouteObstructed) continue;
		const owned = defined(
			model.relations.find(({ relation }) => relation.id === rejected.relationId),
		);
		const retryOwner = retryableOwner(model, owned.ownerId);
		if (retryOwner === undefined) continue;
		return retryOwner;
	}
	return undefined;
}

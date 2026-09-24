import type { RegionCompositionModel } from './region-composition-model';
import {
	type RegionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from './region-geometry-diagnostic';
import {
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from './region-incident-contract';

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

export function retryOwnerForIncidentFailure(
	model: RegionCompositionModel,
	failure: RegionGeometryDiagnostic,
): string | undefined {
	if (!RETRYABLE_INCIDENT_CODES.has(failure.code)) return undefined;
	const owned = model.relations.find(({ relation }) => relation.id === failure.relationId);
	const ownerId = owned?.ownerId;
	if (ownerId === undefined) return undefined;
	const owner = model.regionsById.get(ownerId);
	if (owner === undefined || owner.childIds.length === 0) return undefined;
	if (owner.definition.grid !== undefined) return undefined;
	return ownerId;
}

/** A rejected leaf route may be resolved by one alternate side of its owning row. */
export function retryOwnerForLeafContractFailure(
	model: RegionCompositionModel,
	code: RegionIncidentUnknownCode | RegionGeometryDiagnosticCode | undefined,
	witness: RegionIncidentSearchWitness | undefined,
): string | undefined {
	if (code !== RegionIncidentUnknownCode.NoValidAlternative) return undefined;
	for (const rejected of witness?.rejectedAlternatives ?? []) {
		if (rejected.code !== RegionIncidentRejectionCode.RouteObstructed) continue;
		const owned = model.relations.find(({ relation }) => relation.id === rejected.relationId);
		const ownerId = owned?.ownerId;
		if (ownerId === undefined) continue;
		const owner = model.regionsById.get(ownerId);
		if (owner === undefined || owner.childIds.length === 0) continue;
		if (owner.definition.grid !== undefined) continue;
		return ownerId;
	}
	return undefined;
}

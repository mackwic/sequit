import { defined } from '../document/logic-document';
import type { RegionCompositionModel } from './region-composition-model';
import {
	type RegionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from './region-geometry-diagnostic';

const RETRYABLE_INCIDENT_CODES = new Set([
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
	if (owner?.childIds.length === 0) return undefined;
	if (ownerId === model.rootId) {
		const relation = defined(owned);
		const sourceLanes = model.regionsById.get(relation.sourceLeafId)?.definition.lanePresentation;
		const targetLanes = model.regionsById.get(relation.targetLeafId)?.definition.lanePresentation;
		if (sourceLanes === undefined && targetLanes === undefined) return undefined;
	}
	if (ownerId !== model.rootId && owner?.definition.layout === undefined) return undefined;
	return ownerId;
}

export function retryGhostLeafForCompositionFailure(
	failure: RegionGeometryDiagnostic | undefined,
): boolean {
	return failure?.code === RegionGeometryDiagnosticCode.ParentRouteContact;
}

import { defined, EndpointKind, type LogicRelation } from '../document/logic-document';
import type { Bounds, LayoutElement, Point } from './layout-types';
import { orthogonal, samePoint, segmentEnters } from './nested-region-geometry-primitives';
import { pathsTouchWithoutBridge } from './nested-region-leaf-incident-contacts';
import {
	type NestedOwnedRoute,
	NestedPortalSide,
	type NestedRegionPortal,
	type NestedRegionSelected,
} from './nested-region-types';
import {
	type RegionCompositionModel,
	RegionRelationKind,
	type RegionRelationOwnership,
} from './region-composition-model';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
	type RegionGeometryProvenance,
	RegionIncidentRole as IncidentRole,
} from './region-geometry-diagnostic';

interface LeafIncident {
	readonly relation: LogicRelation;
	readonly endpointId: string;
	readonly leafId: string;
	readonly role: IncidentRole;
	readonly portal: NestedRegionPortal;
	readonly piece: NestedOwnedRoute;
	readonly anchor: Point;
}

function incidentDiagnostic(
	incident: LeafIncident,
	code: RegionGeometryDiagnosticCode,
	message: string,
	provenance: RegionGeometryProvenance = {},
): RegionGeometryDiagnostic {
	return regionGeometryDiagnostic(code, message, {
		relationId: incident.relation.id,
		regionId: incident.leafId,
		endpointId: incident.endpointId,
		role: incident.role,
		...provenance,
	});
}

function onFace(anchor: Point, bounds: Bounds, side: NestedPortalSide): boolean {
	if (side === NestedPortalSide.Top || side === NestedPortalSide.Bottom) {
		const right = bounds.x + bounds.width;
		const horizontal = anchor.x > bounds.x && anchor.x < right;
		if (!horizontal) return false;
		if (side === NestedPortalSide.Top) return anchor.y === bounds.y;
		return anchor.y === bounds.y + bounds.height;
	}
	const bottom = bounds.y + bounds.height;
	const vertical = anchor.y > bounds.y && anchor.y < bottom;
	if (!vertical) return false;
	if (side === NestedPortalSide.Left) return anchor.x === bounds.x;
	return anchor.x === bounds.x + bounds.width;
}

function matchesLeafPortal(
	portal: NestedRegionPortal,
	relationId: string,
	leafId: string,
	endpointId: string,
): boolean {
	if (portal.relationId !== relationId) return false;
	if (portal.regionId !== leafId) return false;
	return portal.endpointId === endpointId;
}

function incidentFor(
	owned: RegionRelationOwnership,
	role: IncidentRole,
	candidate: NestedRegionSelected,
): LeafIncident | RegionGeometryDiagnostic {
	const { relation } = owned;
	let endpointId = relation.to;
	let leafId = owned.targetLeafId;
	if (role === IncidentRole.Source) {
		endpointId = relation.from;
		leafId = owned.sourceLeafId;
	}
	const portals = candidate.portals.filter((portal) =>
		matchesLeafPortal(portal, relation.id, leafId, endpointId),
	);
	if (portals.length !== 1)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.IncidentPortalInventory,
			`Relation ${relation.id} has ${portals.length} ${role} portals on leaf ${leafId}; expected one.`,
			{ relationId: relation.id, regionId: leafId, endpointId, role },
		);
	const pieces = candidate.ownedRoutes.filter(
		(piece) => piece.relationId === relation.id && piece.regionId === leafId,
	);
	if (pieces.length !== 1)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.IncidentPieceInventory,
			`Relation ${relation.id} has ${pieces.length} ${role} incident pieces in leaf ${leafId}; expected one.`,
			{ relationId: relation.id, regionId: leafId, endpointId, role },
		);
	const piece = defined(pieces[0]);
	const portal = defined(portals[0]);
	if (!orthogonal(piece.points))
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.NonOrthogonalIncident,
			`Relation ${relation.id} has a non-orthogonal ${role} incident in leaf ${leafId}.`,
			{ relationId: relation.id, regionId: leafId, endpointId, role },
		);
	let anchor = defined(piece.points.at(-1));
	if (role === IncidentRole.Source) anchor = defined(piece.points[0]);
	return { relation, endpointId, leafId, role, portal, piece, anchor };
}

function elementFor(
	incident: LeafIncident,
	elementsById: ReadonlyMap<string, LayoutElement>,
): LayoutElement | RegionGeometryDiagnostic {
	const element = elementsById.get(incident.endpointId);
	if (element === undefined)
		return incidentDiagnostic(
			incident,
			RegionGeometryDiagnosticCode.MissingIncidentNode,
			`Relation ${incident.relation.id} has no ${incident.role} node ${incident.endpointId}.`,
		);
	return element;
}

function localConnectionAt(
	local: LogicRelation,
	points: readonly Point[],
	endpointId: string,
	anchor: Point,
): Point | undefined {
	if (local.from === endpointId) {
		const start = points[0];
		if (start !== undefined && samePoint(start, anchor)) return anchor;
	}
	const end = points.at(-1);
	if (local.to === endpointId) {
		if (end !== undefined && samePoint(end, anchor)) return anchor;
	}
	return undefined;
}

function foreignNodeFailure(
	incident: LeafIncident,
	model: RegionCompositionModel,
	candidate: NestedRegionSelected,
): RegionGeometryDiagnostic | undefined {
	const endpoint = candidate.layout.elements.find(({ id }) => id === incident.endpointId);
	const groupId = model.parentGroupByEndpointId.get(incident.endpointId);
	let directGroupId: string | undefined;
	if (endpoint?.kind === EndpointKind.Node && groupId !== undefined)
		if (!model.parentGroupByEndpointId.has(groupId)) directGroupId = groupId;
	for (const foreign of candidate.layout.elements) {
		if (foreign.id === incident.endpointId) continue;
		if (model.leafByEndpointId.get(foreign.id) !== incident.leafId) continue;
		if (foreign.id === directGroupId && crossesDirectGroupFace(incident, foreign)) continue;
		if (segmentEnters(incident.piece.points, foreign.bounds))
			return incidentDiagnostic(
				incident,
				RegionGeometryDiagnosticCode.IncidentCrossesForeignNode,
				`Relation ${incident.relation.id} ${incident.role} incident in leaf ${incident.leafId} crosses foreign node ${foreign.id}.`,
				{ relatedEndpointId: foreign.id },
			);
	}
	return undefined;
}

function crossesDirectGroupFace(incident: LeafIncident, group: LayoutElement): boolean {
	if (incident.piece.points.length !== 2) return false;
	const { anchor, portal } = incident;
	const { x, y, width, height } = group.bounds;
	const right = x + width;
	const bottom = y + height;
	const level = anchor.y === portal.point.y;
	const insideHeight = anchor.y > y && anchor.y < bottom;
	if (!level || !insideHeight) return false;
	const insideWidth = anchor.x > x && anchor.x < right;
	if (!insideWidth) return false;
	if (portal.side === NestedPortalSide.Left) return portal.point.x < x;
	return portal.side === NestedPortalSide.Right && portal.point.x > right;
}

function localRouteFailure(
	incident: LeafIncident,
	model: RegionCompositionModel,
	candidate: NestedRegionSelected,
): RegionGeometryDiagnostic | undefined {
	for (const local of model.localRelationsByOwner.get(incident.leafId) ?? []) {
		const route = candidate.ownedRoutes.find(
			(piece) => piece.regionId === incident.leafId && piece.relationId === local.id,
		);
		if (route === undefined)
			return incidentDiagnostic(
				incident,
				RegionGeometryDiagnosticCode.LocalRelationMissing,
				`Local relation ${local.id} is missing from leaf ${incident.leafId}.`,
				{ relatedRelationId: local.id },
			);
		if (!orthogonal(route.points))
			return incidentDiagnostic(
				incident,
				RegionGeometryDiagnosticCode.LocalRelationNonOrthogonal,
				`Local relation ${local.id} has a non-orthogonal route in leaf ${incident.leafId}.`,
				{ relatedRelationId: local.id },
			);
		const allowed = localConnectionAt(local, route.points, incident.endpointId, incident.anchor);
		if (pathsTouchWithoutBridge(incident.piece.points, route.points, allowed))
			return incidentDiagnostic(
				incident,
				RegionGeometryDiagnosticCode.IncidentTouchesLocalRelation,
				`Relation ${incident.relation.id} incident touches local relation ${local.id} in leaf ${incident.leafId} without a defined bridge.`,
				{ relatedRelationId: local.id },
			);
	}
	return undefined;
}

function leafFailure(
	incident: LeafIncident,
	model: RegionCompositionModel,
	candidate: NestedRegionSelected,
	elementsById: ReadonlyMap<string, LayoutElement>,
): RegionGeometryDiagnostic | undefined {
	const element = elementFor(incident, elementsById);
	if ('code' in element) return element;
	if (!onFace(incident.anchor, element.bounds, incident.portal.side))
		return incidentDiagnostic(
			incident,
			RegionGeometryDiagnosticCode.IncidentWrongAttachment,
			`Relation ${incident.relation.id} ${incident.role} incident in leaf ${incident.leafId} does not attach to node ${incident.endpointId} on its ${incident.portal.side} face.`,
		);
	return (
		foreignNodeFailure(incident, model, candidate) ?? localRouteFailure(incident, model, candidate)
	);
}

/** Complement to chain/opacity validation: inspect incident geometry inside each leaf. */
export function validateNestedRegionLeafIncidents(
	model: RegionCompositionModel,
	candidate: NestedRegionSelected,
): RegionGeometryDiagnostic | undefined {
	const elementsById = new Map(candidate.layout.elements.map((element) => [element.id, element]));
	for (const owned of model.relations) {
		if (owned.kind !== RegionRelationKind.Crossing) continue;
		for (const role of [IncidentRole.Source, IncidentRole.Target]) {
			const incident = incidentFor(owned, role, candidate);
			if ('code' in incident) return incident;
			const failure = leafFailure(incident, model, candidate, elementsById);
			if (failure !== undefined) return failure;
		}
	}
	return undefined;
}

/** Display adapter for callers that only need the established wording. */
export function validateNestedRegionLeafIncidentsMessage(
	model: RegionCompositionModel,
	candidate: NestedRegionSelected,
): string | undefined {
	return validateNestedRegionLeafIncidents(model, candidate)?.message;
}

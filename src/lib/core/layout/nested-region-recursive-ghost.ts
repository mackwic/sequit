import { defined, type LayoutPolicy, type LogicDocument } from '../document/logic-document';
import type { LayoutMeasurements } from './layout-types';
import {
	boundaryPortal,
	type RegionIncidentPath,
	type SolvedRecursiveRegion,
} from './nested-region-recursive-geometry';
import type { IncidentSides, RecursiveContext } from './nested-region-recursive-model-adapter';
import { type RegionCompositionModel, RegionRelationKind } from './region-composition-model';
import { RegionIncidentGhostStatus } from './region-incident-ghost';
import {
	RegionGhostIncidentRole,
	type RegionIncidentGhostMultipleInput,
	solveRegionLeafWithGhostIncidents,
} from './region-incident-ghost-multiple';

interface GhostLeafInput {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly incidentSides: IncidentSides;
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly policy: LayoutPolicy | undefined;
}

export function multiIncidentLeaves(model: RegionCompositionModel): readonly string[] {
	const incidentCounts = new Map<string, number>();
	for (const owned of model.relations) {
		if (owned.kind !== RegionRelationKind.Crossing) continue;
		for (const leafId of [owned.sourceLeafId, owned.targetLeafId])
			incidentCounts.set(leafId, (incidentCounts.get(leafId) ?? 0) + 1);
	}
	return model.preorderIds.filter((id) => {
		const count = incidentCounts.get(id) ?? 0;
		return count >= 2 && count <= 4;
	});
}

/** Try one bounded joint solve so every incident observes the same leaf geometry. */
export function solveGhostLeaf(input: GhostLeafInput): SolvedRecursiveRegion | undefined {
	const { context, regionId, incidentSides, document, measurements, policy } = input;
	if (context.ghostLeafIds?.has(regionId) !== true) return undefined;
	if (document.presentation !== undefined) return undefined;
	const incidents = [...incidentSides].map(([relationId, side]) => {
		const owned = defined(context.ownershipByRelationId.get(relationId));
		let endpointId = owned.relation.to;
		let role = RegionGhostIncidentRole.Target;
		if (owned.sourceLeafId === regionId) {
			endpointId = owned.relation.from;
			role = RegionGhostIncidentRole.Source;
		}
		return { relationId, endpointId, side, role };
	});
	let ghostInput: RegionIncidentGhostMultipleInput = { document, measurements, incidents };
	if (policy !== undefined) ghostInput = { ...ghostInput, policy };
	if (context.cache !== undefined) ghostInput = { ...ghostInput, cache: context.cache };
	const ghost = solveRegionLeafWithGhostIncidents(ghostInput);
	if (ghost.status !== RegionIncidentGhostStatus.Selected) return undefined;
	const incidentPaths = new Map<string, RegionIncidentPath>();
	for (const incident of ghost.incidents) {
		const portal = boundaryPortal({
			relationId: incident.relationId,
			endpointId: incident.endpointId,
			regionId,
			side: incident.side,
			x: incident.portal.x,
			canvasHeight: ghost.layout.height,
		});
		let points = [portal.point, ...incident.points];
		if (incident.role === RegionGhostIncidentRole.Source)
			points = [...incident.points, portal.point];
		incidentPaths.set(incident.relationId, {
			relationId: incident.relationId,
			endpointId: incident.endpointId,
			pieces: [{ relationId: incident.relationId, regionId, points }],
			portals: [portal],
		});
	}
	return {
		layout: ghost.layout,
		ranks: ghost.ranks,
		regions: [],
		portals: [],
		ownedRoutes: ghost.layout.relations.map((relation) => ({
			relationId: relation.id,
			regionId,
			points: relation.points,
		})),
		incidentPaths,
	};
}

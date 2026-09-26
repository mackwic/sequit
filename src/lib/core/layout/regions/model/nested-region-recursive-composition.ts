import { defined, type LogicRelation } from '../../../document/logic-document';
import type { LayoutRelation } from '../../layout-types';
import {
	allocateNestedTracks,
	type RoutingTrackDemand,
	trackOffset,
} from '../../resources/routing-resource-allocation';
import {
	boundaryPortal,
	type RegionIncidentPath,
	rowBus,
	rowBusEdge,
	type SolvedRecursiveRegion,
	stitchedRoute,
	translatedIncidentPath,
} from './nested-region-recursive-geometry';
import {
	directChild,
	type IncidentSides,
	type RecursiveContext,
} from './nested-region-recursive-model-adapter';
import type {
	RegionChildPlacement,
	RegionOwnedRoute,
	RegionPortal,
	RegionPortalSide,
} from './region-composition-types';

interface PositionedChildren {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly children: readonly { readonly id: string; readonly solved: SolvedRecursiveRegion }[];
	readonly placements: readonly RegionChildPlacement[];
}

interface CrossingDraft {
	readonly relation: LogicRelation;
	readonly sourcePath: RegionIncidentPath;
	readonly targetPath: RegionIncidentPath;
	readonly sourcePortal: RegionPortal;
	readonly targetPortal: RegionPortal;
}

function crossingDraft(input: PositionedChildren, relation: LogicRelation): CrossingDraft {
	const { context, regionId, children, placements } = input;
	const sourceChildId = directChild(context, regionId, relation.from);
	const targetChildId = directChild(context, regionId, relation.to);
	const region = defined(context.model.regionsById.get(regionId));
	const sourceIndex = region.childIds.indexOf(sourceChildId);
	const targetIndex = region.childIds.indexOf(targetChildId);
	const source = defined(children[sourceIndex]);
	const target = defined(children[targetIndex]);
	const sourcePlacement = defined(placements[sourceIndex]);
	const targetPlacement = defined(placements[targetIndex]);
	const sourcePath = translatedIncidentPath(
		defined(source.solved.incidentPaths.get(relation.id)),
		sourcePlacement.translation,
	);
	const targetPath = translatedIncidentPath(
		defined(target.solved.incidentPaths.get(relation.id)),
		targetPlacement.translation,
	);
	return {
		relation,
		sourcePath,
		targetPath,
		sourcePortal: defined(sourcePath.portals.at(-1)),
		targetPortal: defined(targetPath.portals[0]),
	};
}

function trackDemand(draft: CrossingDraft): RoutingTrackDemand {
	return {
		relationId: draft.relation.id,
		start: draft.sourcePortal.point.x,
		end: draft.targetPortal.point.x,
	};
}

export function composeCrossings(
	input: PositionedChildren & {
		readonly crossings: readonly LogicRelation[];
		readonly localSide: RegionPortalSide;
		readonly bottomBusEdge: number;
		readonly relationsById: Map<string, LayoutRelation>;
		readonly portals: RegionPortal[];
		readonly ownedRoutes: RegionOwnedRoute[];
	},
): void {
	const { regionId } = input;
	const drafts = input.crossings.map((relation) => crossingDraft(input, relation));
	const edge = rowBusEdge(regionId, input.crossings.length);
	const allocation = allocateNestedTracks(edge, drafts.map(trackDemand));
	for (const draft of drafts) {
		const { relation, sourcePath, targetPath, sourcePortal, targetPortal } = draft;
		const bus = rowBus({
			relation,
			regionId,
			offset: trackOffset(edge, defined(allocation.trackByRelationId.get(relation.id))),
			source: sourcePortal.point,
			target: targetPortal.point,
			childTop: defined(input.placements[0]).bounds.y,
			bottomBusEdge: input.bottomBusEdge,
			portalSide: input.localSide,
		});
		const pieces = [...sourcePath.pieces, bus, ...targetPath.pieces];
		input.relationsById.set(relation.id, stitchedRoute(relation, pieces));
		input.portals.push(...sourcePath.portals, ...targetPath.portals);
		input.ownedRoutes.push(...pieces);
	}
}

export function inheritedIncidentPaths(
	input: PositionedChildren & {
		readonly incidentSides: IncidentSides;
		readonly layoutWidth: number;
		readonly layoutHeight: number;
	},
): ReadonlyMap<string, RegionIncidentPath> {
	const { context, regionId, children, placements } = input;
	const region = defined(context.model.regionsById.get(regionId));
	const incidentPaths = new Map<string, RegionIncidentPath>();
	for (const [relationId, sides] of input.incidentSides) {
		const side = defined(sides[0]);
		const owned = defined(context.ownershipByRelationId.get(relationId));
		const isSource = owned.sourcePathToOwner.includes(regionId);
		let endpointId = owned.relation.to;
		if (isSource) endpointId = owned.relation.from;
		const childId = directChild(context, regionId, endpointId);
		const childIndex = region.childIds.indexOf(childId);
		const child = defined(children[childIndex]);
		const placement = defined(placements[childIndex]);
		const path = translatedIncidentPath(
			defined(child.solved.incidentPaths.get(relationId)),
			placement.translation,
		);
		let childPortal = defined(path.portals[0]);
		if (isSource) childPortal = defined(path.portals.at(-1));
		const portal = boundaryPortal({
			relationId,
			endpointId,
			regionId,
			side,
			x: childPortal.point.x,
			y: childPortal.point.y,
			canvasWidth: input.layoutWidth,
			canvasHeight: input.layoutHeight,
		});
		let points = [portal.point, childPortal.point];
		if (isSource) points = [childPortal.point, portal.point];
		const piece = { relationId, regionId, points };
		let pieces = [piece, ...path.pieces];
		let pathPortals = [portal, ...path.portals];
		if (isSource) {
			pieces = [...path.pieces, piece];
			pathPortals = [...path.portals, portal];
		}
		incidentPaths.set(relationId, { relationId, endpointId, pieces, portals: pathPortals });
	}
	return incidentPaths;
}

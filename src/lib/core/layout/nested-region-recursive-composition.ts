import { defined, type LogicRelation } from '../document/logic-document';
import type { LayoutRelation } from './layout-types';
import {
	boundaryPortal,
	type RegionIncidentPath,
	rowBus,
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
	NestedOwnedRoute,
	NestedRegionPlacement,
	NestedRegionPortal,
} from './nested-region-types';
import { NestedPortalSide } from './nested-region-types';
import { RegionPortalSide } from './region-composition-types';

function nestedSide(side: RegionPortalSide): NestedPortalSide {
	switch (side) {
		case RegionPortalSide.Top:
			return NestedPortalSide.Top;
		case RegionPortalSide.Right:
			return NestedPortalSide.Right;
		case RegionPortalSide.Bottom:
			return NestedPortalSide.Bottom;
		case RegionPortalSide.Left:
			return NestedPortalSide.Left;
		default:
			throw new Error(`Unsupported region portal side ${String(side)}.`);
	}
}

interface PositionedChildren {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly children: readonly { readonly id: string; readonly solved: SolvedRecursiveRegion }[];
	readonly placements: readonly NestedRegionPlacement[];
}

interface CrossingDraft {
	readonly relation: LogicRelation;
	readonly sourceChildId: string;
	readonly targetChildId: string;
	readonly sourcePath: RegionIncidentPath;
	readonly targetPath: RegionIncidentPath;
	readonly sourcePortal: NestedRegionPortal;
	readonly targetPortal: NestedRegionPortal;
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
		sourceChildId,
		targetChildId,
		sourcePath,
		targetPath,
		sourcePortal: defined(sourcePath.portals.at(-1)),
		targetPortal: defined(targetPath.portals[0]),
	};
}

function strictlyContains(outer: CrossingDraft, inner: CrossingDraft): boolean {
	const outerMin = Math.min(outer.sourcePortal.point.x, outer.targetPortal.point.x);
	const outerMax = Math.max(outer.sourcePortal.point.x, outer.targetPortal.point.x);
	const innerMin = Math.min(inner.sourcePortal.point.x, inner.targetPortal.point.x);
	const innerMax = Math.max(inner.sourcePortal.point.x, inner.targetPortal.point.x);
	return outerMin < innerMin && innerMax < outerMax;
}

function busRailIndices(
	input: PositionedChildren,
	drafts: readonly CrossingDraft[],
): readonly number[] {
	if (drafts.length !== 2) return drafts.map((_, index) => index);
	const gridChild = input.children.find(
		({ id }) =>
			defined(input.context.model.regionsById.get(id)).definition.grid !== undefined &&
			drafts.every((draft) => draft.sourceChildId === id || draft.targetChildId === id),
	);
	const first = defined(drafts[0]);
	const second = defined(drafts[1]);
	// A containing arc must use the rail farther from the children. Keep all other
	// pairs in canonical order; interleaved intervals still need a bridge.
	if (gridChild !== undefined && strictlyContains(first, second)) return [1, 0];
	return [0, 1];
}

export function composeCrossings(
	input: PositionedChildren & {
		readonly crossings: readonly LogicRelation[];
		readonly localSide: NestedPortalSide;
		readonly bottomBusEdge: number;
		readonly relationsById: Map<string, LayoutRelation>;
		readonly portals: NestedRegionPortal[];
		readonly ownedRoutes: NestedOwnedRoute[];
	},
): void {
	const { regionId } = input;
	const drafts = input.crossings.map((relation) => crossingDraft(input, relation));
	const railIndices = busRailIndices(input, drafts);
	for (const [index, draft] of drafts.entries()) {
		const { relation, sourcePath, targetPath, sourcePortal, targetPortal } = draft;
		const bus = rowBus({
			relation,
			regionId,
			index: defined(railIndices[index]),
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
		const side = nestedSide(defined(sides[0]));
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

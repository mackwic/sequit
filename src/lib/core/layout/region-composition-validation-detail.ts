import { defined } from '../document/logic-document';
import type { Bounds, LayoutElement, LayoutRelation, LayoutResult, Point } from './layout-types';
import {
	finiteBounds,
	inside,
	orthogonalPathsTouch,
	within,
} from './nested-region-geometry-primitives';
import type { RegionCompositionModel } from './region-composition-model';
import type { RegionOwnedRoute } from './region-composition-types';
import type {
	RegionCompositionGeometryCandidate,
	RegionGeometryPlacement,
} from './region-composition-validation-types';

function translatedBoundsMatch(local: Bounds, global: Bounds, translation: Point): boolean {
	if (global.x !== local.x + translation.x) return false;
	if (global.y !== local.y + translation.y) return false;
	if (global.width !== local.width) return false;
	return global.height === local.height;
}

function translatedRouteMatches(
	local: LayoutRelation,
	global: LayoutRelation,
	translation: Point,
): boolean {
	if (local.from !== global.from || local.to !== global.to) return false;
	if (local.points.length !== global.points.length) return false;
	return local.points.every((point, index) => {
		const globalPoint = defined(global.points[index]);
		if (globalPoint.x !== point.x + translation.x) return false;
		return globalPoint.y === point.y + translation.y;
	});
}

function elementWithinLeaf(element: LayoutElement, leaf: RegionGeometryPlacement): boolean {
	const { bounds } = element;
	if (!finiteBounds(bounds)) return false;
	if (!within(leaf.bounds, { x: bounds.x, y: bounds.y })) return false;
	return within(leaf.bounds, {
		x: bounds.x + bounds.width,
		y: bounds.y + bounds.height,
	});
}

function leafElementsFailure(
	leafId: string,
	placement: RegionGeometryPlacement,
	globalById: ReadonlyMap<string, LayoutElement>,
	model: RegionCompositionModel,
): string | undefined {
	const { localLayout, translation } = placement;
	if (localLayout === undefined || translation === undefined)
		return `Leaf region ${leafId} has no local layout or translation.`;
	const expected = [...model.leafByEndpointId]
		.filter(([, ownerId]) => ownerId === leafId)
		.map(([id]) => id);
	const localById = new Map(localLayout.elements.map((element) => [element.id, element]));
	if (localLayout.elements.length !== expected.length || localById.size !== expected.length)
		return `Leaf region ${leafId} does not contain each local element exactly once.`;
	for (const id of expected) {
		const local = localById.get(id);
		const global = globalById.get(id);
		if (local === undefined || global === undefined)
			return `Leaf region ${leafId} does not contain each local element exactly once.`;
		if (local.kind !== global.kind) return `Element ${id} differs from its translated leaf layout.`;
		if (!translatedBoundsMatch(local.bounds, global.bounds, translation))
			return `Element ${id} differs from its translated leaf layout.`;
		if (!elementWithinLeaf(global, placement))
			return `Element ${id} leaves its leaf region ${leafId}.`;
	}
	return undefined;
}

function leafRoutesFailure(
	leafId: string,
	placement: RegionGeometryPlacement,
	globalById: ReadonlyMap<string, LayoutRelation>,
	model: RegionCompositionModel,
): string | undefined {
	const { localLayout, translation } = placement;
	if (localLayout === undefined || translation === undefined)
		return `Leaf region ${leafId} has no local layout or translation.`;
	const expected = model.localRelationsByOwner.get(leafId) ?? [];
	const localById = new Map(localLayout.relations.map((route) => [route.id, route]));
	if (localLayout.relations.length !== expected.length || localById.size !== expected.length)
		return `Leaf region ${leafId} does not contain each local relation exactly once.`;
	for (const relation of expected) {
		const local = localById.get(relation.id);
		const global = globalById.get(relation.id);
		if (local === undefined || global === undefined)
			return `Leaf region ${leafId} does not contain each local relation exactly once.`;
		if (local.from !== relation.from || local.to !== relation.to)
			return `Relation ${relation.id} differs from its translated leaf layout.`;
		if (!translatedRouteMatches(local, global, translation))
			return `Relation ${relation.id} differs from its translated leaf layout.`;
	}
	return undefined;
}

function groupContainmentFailure(
	leafId: string,
	globalById: ReadonlyMap<string, LayoutElement>,
	model: RegionCompositionModel,
): string | undefined {
	for (const [endpointId, groupId] of model.parentGroupByEndpointId) {
		if (model.leafByEndpointId.get(endpointId) !== leafId) continue;
		const member = defined(globalById.get(endpointId));
		const group = defined(globalById.get(groupId));
		if (!inside(group.bounds, member.bounds))
			return `Element ${endpointId} leaves its parent group ${groupId} in leaf region ${leafId}.`;
	}
	return undefined;
}

function lanePlacementFailure(
	regionId: string,
	local: NonNullable<LayoutResult['lanes']>[number],
	global: NonNullable<LayoutResult['lanes']>[number],
	placement: RegionGeometryPlacement,
): string | undefined {
	const correctOwner = local.regionId === regionId;
	const sameIdentity = global.id === local.id && global.label === local.label;
	if (!correctOwner || !sameIdentity) return `Lane ${local.id} differs from its leaf layout.`;
	if (!finiteBounds(global.bounds) || !inside(placement.bounds, global.bounds))
		return `Lane ${local.id} leaves its leaf region ${regionId}.`;
	if (
		placement.translation === undefined ||
		!translatedBoundsMatch(local.bounds, global.bounds, placement.translation)
	)
		return `Lane ${local.id} differs from its translated leaf layout.`;
	return undefined;
}

function leafLaneGeometryFailure(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
	placements: ReadonlyMap<string, RegionGeometryPlacement>,
): string | undefined {
	const published = candidate.layout.lanes ?? [];
	let expectedCount = 0;
	for (const region of model.regionsById.values()) {
		if (region.childIds.length > 0 || region.id === model.rootId) continue;
		const placement = defined(placements.get(region.id));
		const local = placement.localLayout?.lanes ?? [];
		const owned = published.filter(({ regionId }) => regionId === region.id);
		expectedCount += local.length;
		if (owned.length !== local.length)
			return `Leaf region ${region.id} does not publish each local lane exactly once.`;
		for (const [index, lane] of local.entries()) {
			const global = defined(owned[index]);
			const failure = lanePlacementFailure(region.id, lane, global, placement);
			if (failure !== undefined) return failure;
		}
	}
	if (published.length !== expectedCount)
		return 'The composed canvas has an unknown or duplicate lane.';
	return undefined;
}

export function validateLeafCompositionGeometry(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
	placements: ReadonlyMap<string, RegionGeometryPlacement>,
): string | undefined {
	const expectedIds = model.leafByEndpointId;
	const globalElements = candidate.layout.elements;
	const elementsById = new Map(globalElements.map((element) => [element.id, element]));
	if (globalElements.length !== expectedIds.size || elementsById.size !== expectedIds.size)
		return 'The composed canvas does not contain each element exactly once.';
	if (globalElements.some(({ id }) => !expectedIds.has(id)))
		return 'The composed canvas has an unknown element.';
	const routesById = new Map(candidate.layout.relations.map((route) => [route.id, route]));
	for (const region of model.regionsById.values()) {
		if (region.childIds.length > 0 || region.id === model.rootId) continue;
		const placement = defined(placements.get(region.id));
		const elements = leafElementsFailure(region.id, placement, elementsById, model);
		if (elements !== undefined) return elements;
		const groups = groupContainmentFailure(region.id, elementsById, model);
		if (groups !== undefined) return groups;
		const routes = leafRoutesFailure(region.id, placement, routesById, model);
		if (routes !== undefined) return routes;
	}
	return leafLaneGeometryFailure(model, candidate, placements);
}

/** Inner-region routes may touch only when a bridge policy explicitly permits it. */
export function validateParentRouteContacts(
	model: RegionCompositionModel,
	ownedRoutes: readonly RegionOwnedRoute[],
): string | undefined {
	for (const [index, route] of ownedRoutes.entries()) {
		const owner = model.regionsById.get(route.regionId);
		if (owner === undefined || owner.childIds.length === 0) continue;
		for (const other of ownedRoutes.slice(index + 1)) {
			if (other.regionId !== route.regionId || other.relationId === route.relationId) continue;
			if (orthogonalPathsTouch(route.points, other.points))
				return `Region ${route.regionId} routes ${route.relationId} and ${other.relationId} intersect without a bridge.`;
		}
	}
	return undefined;
}

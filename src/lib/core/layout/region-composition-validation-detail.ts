import { defined } from '../document/logic-document';
import { unbridgedContacts } from './bridges/bridge-contact';
import { type LayoutBridge, type RoutedPath, validatedBridges } from './bridges/bridge-oracle';
import { finiteBounds, inside, within } from './geometry/nested-region-geometry-primitives';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic as diagnostic,
	RegionGeometryDiagnosticCode as Code,
} from './geometry/region-geometry-diagnostic';
import type { Bounds, LayoutElement, LayoutRelation, LayoutResult, Point } from './layout-types';
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
): RegionGeometryDiagnostic | undefined {
	const { localLayout, translation } = placement;
	if (localLayout === undefined || translation === undefined)
		return diagnostic(
			Code.MissingLeafLayout,
			`Leaf region ${leafId} has no local layout or translation.`,
			{
				regionId: leafId,
			},
		);
	const expected = [...model.leafByEndpointId]
		.filter(([, ownerId]) => ownerId === leafId)
		.map(([id]) => id);
	const localById = new Map(localLayout.elements.map((element) => [element.id, element]));
	if (localLayout.elements.length !== expected.length || localById.size !== expected.length)
		return diagnostic(
			Code.LeafElementInventory,
			`Leaf region ${leafId} does not contain each local element exactly once.`,
			{ regionId: leafId },
		);
	for (const id of expected) {
		const local = localById.get(id);
		const global = globalById.get(id);
		if (local === undefined || global === undefined)
			return diagnostic(
				Code.LeafElementInventory,
				`Leaf region ${leafId} does not contain each local element exactly once.`,
				{ regionId: leafId, endpointId: id },
			);
		if (local.kind !== global.kind)
			return diagnostic(
				Code.TranslatedElementMismatch,
				`Element ${id} differs from its translated leaf layout.`,
				{
					regionId: leafId,
					endpointId: id,
				},
			);
		if (!translatedBoundsMatch(local.bounds, global.bounds, translation))
			return diagnostic(
				Code.TranslatedElementMismatch,
				`Element ${id} differs from its translated leaf layout.`,
				{
					regionId: leafId,
					endpointId: id,
				},
			);
		if (!elementWithinLeaf(global, placement))
			return diagnostic(
				Code.ElementOutsideLeaf,
				`Element ${id} leaves its leaf region ${leafId}.`,
				{
					regionId: leafId,
					endpointId: id,
				},
			);
	}
	return undefined;
}

function leafRoutesFailure(
	leafId: string,
	placement: RegionGeometryPlacement,
	globalById: ReadonlyMap<string, LayoutRelation>,
	model: RegionCompositionModel,
): RegionGeometryDiagnostic | undefined {
	const { localLayout, translation } = placement;
	if (localLayout === undefined || translation === undefined)
		return diagnostic(
			Code.MissingLeafLayout,
			`Leaf region ${leafId} has no local layout or translation.`,
			{
				regionId: leafId,
			},
		);
	const expected = model.localRelationsByOwner.get(leafId) ?? [];
	const localById = new Map(localLayout.relations.map((route) => [route.id, route]));
	if (localLayout.relations.length !== expected.length || localById.size !== expected.length)
		return diagnostic(
			Code.LeafRelationInventory,
			`Leaf region ${leafId} does not contain each local relation exactly once.`,
			{ regionId: leafId },
		);
	for (const relation of expected) {
		const local = localById.get(relation.id);
		const global = globalById.get(relation.id);
		if (local === undefined || global === undefined)
			return diagnostic(
				Code.LeafRelationInventory,
				`Leaf region ${leafId} does not contain each local relation exactly once.`,
				{ regionId: leafId, relationId: relation.id },
			);
		if (local.from !== relation.from || local.to !== relation.to)
			return diagnostic(
				Code.TranslatedRelationMismatch,
				`Relation ${relation.id} differs from its translated leaf layout.`,
				{ regionId: leafId, relationId: relation.id },
			);
		if (!translatedRouteMatches(local, global, translation))
			return diagnostic(
				Code.TranslatedRelationMismatch,
				`Relation ${relation.id} differs from its translated leaf layout.`,
				{ regionId: leafId, relationId: relation.id },
			);
	}
	return undefined;
}

function groupContainmentFailure(
	leafId: string,
	globalById: ReadonlyMap<string, LayoutElement>,
	model: RegionCompositionModel,
): RegionGeometryDiagnostic | undefined {
	for (const [endpointId, groupId] of model.parentGroupByEndpointId) {
		if (model.leafByEndpointId.get(endpointId) !== leafId) continue;
		const member = defined(globalById.get(endpointId));
		const group = defined(globalById.get(groupId));
		if (!inside(group.bounds, member.bounds))
			return diagnostic(
				Code.MemberOutsideGroup,
				`Element ${endpointId} leaves its parent group ${groupId} in leaf region ${leafId}.`,
				{ regionId: leafId, endpointId, relatedEndpointId: groupId },
			);
	}
	return undefined;
}

function lanePlacementFailure(
	regionId: string,
	local: NonNullable<LayoutResult['lanes']>[number],
	global: NonNullable<LayoutResult['lanes']>[number],
	placement: RegionGeometryPlacement,
): RegionGeometryDiagnostic | undefined {
	const correctOwner = local.regionId === regionId;
	const sameIdentity = global.id === local.id && global.label === local.label;
	if (!correctOwner || !sameIdentity)
		return diagnostic(Code.LaneIdentityMismatch, `Lane ${local.id} differs from its leaf layout.`, {
			regionId,
			laneId: local.id,
		});
	if (!finiteBounds(global.bounds) || !inside(placement.bounds, global.bounds))
		return diagnostic(
			Code.LaneOutsideLeaf,
			`Lane ${local.id} leaves its leaf region ${regionId}.`,
			{
				regionId,
				laneId: local.id,
			},
		);
	if (
		placement.translation === undefined ||
		!translatedBoundsMatch(local.bounds, global.bounds, placement.translation)
	)
		return diagnostic(
			Code.TranslatedLaneMismatch,
			`Lane ${local.id} differs from its translated leaf layout.`,
			{ regionId, laneId: local.id },
		);
	return undefined;
}

function leafLaneGeometryFailure(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
	placements: ReadonlyMap<string, RegionGeometryPlacement>,
): RegionGeometryDiagnostic | undefined {
	const published = candidate.layout.lanes ?? [];
	let expectedCount = 0;
	for (const region of model.regionsById.values()) {
		if (region.childIds.length > 0 || region.id === model.rootId) continue;
		const placement = defined(placements.get(region.id));
		const local = placement.localLayout?.lanes ?? [];
		const owned = published.filter(({ regionId }) => regionId === region.id);
		expectedCount += local.length;
		if (owned.length !== local.length)
			return diagnostic(
				Code.LeafLaneInventory,
				`Leaf region ${region.id} does not publish each local lane exactly once.`,
				{ regionId: region.id },
			);
		for (const [index, lane] of local.entries()) {
			const global = defined(owned[index]);
			const failure = lanePlacementFailure(region.id, lane, global, placement);
			if (failure !== undefined) return failure;
		}
	}
	if (published.length !== expectedCount)
		return diagnostic(
			Code.GlobalLaneInventory,
			'The composed canvas has an unknown or duplicate lane.',
		);
	return undefined;
}

export function validateLeafCompositionGeometry(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
	placements: ReadonlyMap<string, RegionGeometryPlacement>,
): RegionGeometryDiagnostic | undefined {
	const expectedIds = model.leafByEndpointId;
	const globalElements = candidate.layout.elements;
	const elementsById = new Map(globalElements.map((element) => [element.id, element]));
	if (globalElements.length !== expectedIds.size || elementsById.size !== expectedIds.size)
		return diagnostic(
			Code.ElementInventory,
			'The composed canvas does not contain each element exactly once.',
		);
	if (globalElements.some(({ id }) => !expectedIds.has(id)))
		return diagnostic(Code.UnknownElement, 'The composed canvas has an unknown element.');
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
	relations: readonly RoutedPath[] = [],
): string | undefined {
	return diagnoseParentRouteContacts(model, ownedRoutes, relations)?.message;
}

/**
 * A touching pair is accepted only when every contact between the two paths is a strict crossing
 * carried by a validated bridge of `relations`; a T-contact and a collinear overlap never are.
 */
export function diagnoseParentRouteContacts(
	model: RegionCompositionModel,
	ownedRoutes: readonly RegionOwnedRoute[],
	relations: readonly RoutedPath[] = [],
	bridgesValidated?: readonly LayoutBridge[],
): RegionGeometryDiagnostic | undefined {
	const bridges = bridgesValidated ?? validatedBridges(relations);
	for (const [index, route] of ownedRoutes.entries()) {
		const owner = model.regionsById.get(route.regionId);
		if (owner === undefined || owner.childIds.length === 0) continue;
		for (const other of ownedRoutes.slice(index + 1)) {
			if (other.regionId !== route.regionId || other.relationId === route.relationId) continue;
			const unbridged = unbridgedContacts(
				{ id: route.relationId, points: route.points },
				{ id: other.relationId, points: other.points },
				bridges,
			);
			if (unbridged.length > 0)
				return diagnostic(
					Code.ParentRouteContact,
					`Region ${route.regionId} routes ${route.relationId} and ${other.relationId} intersect without a bridge.`,
					{
						relationId: route.relationId,
						regionId: route.regionId,
						relatedRelationId: other.relationId,
					},
				);
		}
	}
	return undefined;
}

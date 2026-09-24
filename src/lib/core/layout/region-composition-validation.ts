import { defined } from '../document/logic-document';
import type { Bounds, Point } from './layout-types';
import {
	finiteBounds,
	inside,
	orthogonal,
	overlaps,
	samePoint,
	segmentEnters,
	within,
} from './nested-region-geometry-primitives';
import type { RegionCompositionModel, RegionRelationOwnership } from './region-composition-model';
import {
	type RegionOwnedRoute,
	type RegionPortal,
	RegionPortalSide,
} from './region-composition-types';
import {
	validateLeafCompositionGeometry,
	validateParentRouteContacts,
} from './region-composition-validation-detail';
import type {
	RegionCompositionGeometryCandidate,
	RegionGeometryPlacement,
} from './region-composition-validation-types';

export type { RegionCompositionGeometryCandidate } from './region-composition-validation-types';

interface GeometryContext {
	readonly model: RegionCompositionModel;
	readonly placements: ReadonlyMap<string, RegionGeometryPlacement>;
	readonly root: Bounds;
}

function placementInventoryFailure(
	candidate: RegionCompositionGeometryCandidate,
	context: GeometryContext,
): string | undefined {
	if (candidate.rootId !== context.model.rootId)
		return 'The composed canvas has the wrong root region.';
	if (!finiteBounds(context.root)) return 'The root canvas has invalid dimensions.';
	if (candidate.regions.length !== context.model.preorderIds.length - 1)
		return 'The composed canvas does not contain each child region exactly once.';
	if (context.placements.size !== candidate.regions.length)
		return 'The composed canvas repeats a child region identity.';
	for (const region of candidate.regions)
		if (!context.model.regionsById.has(region.id))
			return `Child region ${region.id} is not in the region model.`;
	return undefined;
}

function regionPlacementFailure(id: string, context: GeometryContext): string | undefined {
	const region = context.placements.get(id);
	const expected = context.model.regionsById.get(id);
	if (region === undefined || expected === undefined)
		return `Child region ${id} is missing from the composed canvas.`;
	if (region.parentId !== expected.parentId) return `Child region ${id} has the wrong parent.`;
	let parent: Bounds | undefined = context.root;
	if (region.parentId !== context.model.rootId)
		parent = context.placements.get(region.parentId)?.bounds;
	if (parent === undefined) return `Child region ${id} is outside its parent.`;
	if (!finiteBounds(region.bounds)) return `Child region ${id} is outside its parent.`;
	if (!inside(parent, region.bounds)) return `Child region ${id} is outside its parent.`;
	return undefined;
}

function siblingsOverlap(siblings: readonly RegionGeometryPlacement[]): boolean {
	for (let left = 0; left < siblings.length; left += 1) {
		const leftBounds = defined(siblings[left]).bounds;
		for (let right = left + 1; right < siblings.length; right += 1) {
			const rightBounds = defined(siblings[right]).bounds;
			if (overlaps(leftBounds, rightBounds)) return true;
		}
	}
	return false;
}

function siblingOverlapFailure(context: GeometryContext): string | undefined {
	for (const parent of context.model.regionsById.values()) {
		const siblings = parent.childIds.map((id) => defined(context.placements.get(id)));
		if (siblingsOverlap(siblings)) return `Children of region ${parent.id} overlap.`;
	}
	return undefined;
}

function placementFailure(
	candidate: RegionCompositionGeometryCandidate,
	context: GeometryContext,
): string | undefined {
	const inventory = placementInventoryFailure(candidate, context);
	if (inventory !== undefined) return inventory;
	for (const id of context.model.preorderIds) {
		if (id === context.model.rootId) continue;
		const failure = regionPlacementFailure(id, context);
		if (failure !== undefined) return failure;
	}
	return siblingOverlapFailure(context);
}

function strictlyBetween(value: number, minimum: number, maximum: number): boolean {
	return value > minimum && value < maximum;
}

function portalOnBoundary(portal: RegionPortal, region: RegionGeometryPlacement): boolean {
	const { x, y, width, height } = region.bounds;
	const point = portal.point;
	if (portal.localPoint.x !== point.x - x) return false;
	if (portal.localPoint.y !== point.y - y) return false;
	const horizontal = strictlyBetween(point.x, x, x + width);
	const vertical = strictlyBetween(point.y, y, y + height);
	const boundaryBySide = {
		[RegionPortalSide.Top]: point.y === y && horizontal,
		[RegionPortalSide.Bottom]: point.y === y + height && horizontal,
		[RegionPortalSide.Left]: point.x === x && vertical,
		[RegionPortalSide.Right]: point.x === x + width && vertical,
	};
	return boundaryBySide[portal.side];
}

function ownedPieceFailure(
	relationId: string,
	piece: RegionOwnedRoute,
	context: GeometryContext,
): string | undefined {
	if (!orthogonal(piece.points)) return `Relation ${relationId} has a non-orthogonal owned piece.`;
	const owner = context.model.regionsById.get(piece.regionId);
	if (owner === undefined) return `Relation ${relationId} has an unknown route owner.`;
	let bounds: Bounds | undefined = context.root;
	if (piece.regionId !== context.model.rootId)
		bounds = context.placements.get(piece.regionId)?.bounds;
	if (bounds === undefined || piece.points.some((point) => !within(bounds, point)))
		return `Relation ${relationId} leaves its owning region ${piece.regionId}.`;
	for (const childId of owner.childIds) {
		const child = context.placements.get(childId);
		if (child !== undefined && segmentEnters(piece.points, child.bounds))
			return `Relation ${relationId} enters opaque child ${childId} from owner ${piece.regionId}.`;
	}
	return undefined;
}

function expectedOwners(owned: RegionRelationOwnership): readonly string[] {
	return [...owned.sourcePathToOwner, owned.ownerId, ...[...owned.targetPathToOwner].reverse()];
}

function expectedPortalRegions(owned: RegionRelationOwnership): readonly string[] {
	return [...owned.sourcePathToOwner, ...[...owned.targetPathToOwner].reverse()];
}

function stitched(pieces: readonly RegionOwnedRoute[]): readonly Point[] {
	const points: Point[] = [];
	for (const piece of pieces)
		if (points.length === 0) points.push(...piece.points);
		else points.push(...piece.points.slice(1));
	return points;
}

function ownedChainFailure(
	owned: RegionRelationOwnership,
	pieces: readonly RegionOwnedRoute[],
	context: GeometryContext,
): string | undefined {
	const owners = expectedOwners(owned);
	if (pieces.length !== owners.length)
		return `Relation ${owned.relation.id} has a missing or extra owned piece.`;
	for (const [index, piece] of pieces.entries()) {
		if (piece.regionId !== owners[index])
			return `Relation ${owned.relation.id} has a wrong boundary owner.`;
		const failure = ownedPieceFailure(owned.relation.id, piece, context);
		if (failure !== undefined) return failure;
	}
	return undefined;
}

function portalChainFailure(
	owned: RegionRelationOwnership,
	pieces: readonly RegionOwnedRoute[],
	portals: readonly RegionPortal[],
	context: GeometryContext,
): string | undefined {
	const { relation } = owned;
	const boundaryIds = expectedPortalRegions(owned);
	if (portals.length !== boundaryIds.length)
		return `Relation ${relation.id} has a missing or extra boundary portal.`;
	for (const [index, portal] of portals.entries()) {
		const expectedId = boundaryIds[index];
		let expectedEndpoint = relation.to;
		if (index < owned.sourcePathToOwner.length) expectedEndpoint = relation.from;
		const region = context.placements.get(expectedId ?? '');
		if (region === undefined) return `Relation ${relation.id} has an invalid boundary portal.`;
		if (portal.regionId !== expectedId || portal.endpointId !== expectedEndpoint)
			return `Relation ${relation.id} has an invalid boundary portal.`;
		if (!portalOnBoundary(portal, region))
			return `Relation ${relation.id} has an invalid boundary portal.`;
		const before = defined(pieces[index]);
		const after = defined(pieces[index + 1]);
		const beforeEnd = defined(before.points.at(-1));
		const afterStart = defined(after.points[0]);
		if (!samePoint(beforeEnd, portal.point) || !samePoint(afterStart, portal.point))
			return `Relation ${relation.id} has a disconnected boundary portal.`;
	}
	return undefined;
}

function relationFailure(
	owned: RegionRelationOwnership,
	candidate: RegionCompositionGeometryCandidate,
	context: GeometryContext,
): string | undefined {
	const { relation } = owned;
	const route = candidate.layout.relations.find(({ id }) => id === relation.id);
	if (route === undefined) return `Relation ${relation.id} has no valid composed route.`;
	if (route.from !== relation.from || route.to !== relation.to)
		return `Relation ${relation.id} has no valid composed route.`;
	const pieces = candidate.ownedRoutes.filter(({ relationId }) => relationId === relation.id);
	const ownerFailure = ownedChainFailure(owned, pieces, context);
	if (ownerFailure !== undefined) return ownerFailure;
	if (!orthogonal(route.points)) return `Relation ${relation.id} has no valid composed route.`;
	const portals = candidate.portals.filter(({ relationId }) => relationId === relation.id);
	const portalFailure = portalChainFailure(owned, pieces, portals, context);
	if (portalFailure !== undefined) return portalFailure;
	const joined = stitched(pieces);
	if (joined.length !== route.points.length)
		return `Relation ${relation.id} differs from its owned pieces.`;
	if (joined.some((point, index) => !samePoint(point, defined(route.points[index]))))
		return `Relation ${relation.id} differs from its owned pieces.`;
	return undefined;
}

/** Validate every boundary in the normalized leaf → LCA → leaf route chain. */
export function validateRegionCompositionGeometry(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
): string | undefined {
	const placements = new Map(candidate.regions.map((region) => [region.id, region]));
	const root = { x: 0, y: 0, width: candidate.layout.width, height: candidate.layout.height };
	const context = { model, placements, root };
	const placement = placementFailure(candidate, context);
	if (placement !== undefined) return placement;
	const leafGeometry = validateLeafCompositionGeometry(model, candidate, placements);
	if (leafGeometry !== undefined) return leafGeometry;
	const relationIds = new Set(model.relations.map(({ relation }) => relation.id));
	if (
		candidate.layout.relations.length !== relationIds.size ||
		new Set(candidate.layout.relations.map(({ id }) => id)).size !== relationIds.size
	)
		return 'The composed canvas does not contain each relation exactly once.';
	if (candidate.layout.relations.some(({ id }) => !relationIds.has(id)))
		return 'The composed canvas has an unknown relation.';
	if (candidate.ownedRoutes.some(({ relationId }) => !relationIds.has(relationId)))
		return 'An owned route has an unknown relation.';
	if (candidate.portals.some(({ relationId }) => !relationIds.has(relationId)))
		return 'A boundary portal has an unknown relation.';
	for (const owned of model.relations) {
		const failure = relationFailure(owned, candidate, context);
		if (failure !== undefined) return failure;
	}
	return validateParentRouteContacts(model, candidate.ownedRoutes);
}

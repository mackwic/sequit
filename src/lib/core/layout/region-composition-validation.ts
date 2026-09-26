import { defined } from '../document/logic-document';
import { type RouteBridgeCache, validatedBridgesCached } from './bridges/bridge-oracle';
import { finiteBounds, inside, overlaps } from './geometry/nested-region-geometry-primitives';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic as diagnostic,
	RegionGeometryDiagnosticCode as Code,
} from './geometry/region-geometry-diagnostic';
import type { Bounds } from './layout-types';
import type { RegionCompositionModel } from './region-composition-model';
import {
	diagnoseParentRouteContacts,
	validateLeafCompositionGeometry,
} from './region-composition-validation-detail';
import { type GeometryContext, relationFailure } from './region-composition-validation-routes';
import type {
	RegionCompositionGeometryCandidate,
	RegionGeometryPlacement,
} from './region-composition-validation-types';

export type { RegionCompositionGeometryCandidate } from './region-composition-validation-types';

function placementInventoryFailure(
	candidate: RegionCompositionGeometryCandidate,
	context: GeometryContext,
): RegionGeometryDiagnostic | undefined {
	if (candidate.rootId !== context.model.rootId)
		return diagnostic(Code.WrongRootRegion, 'The composed canvas has the wrong root region.', {
			regionId: candidate.rootId,
		});
	if (!finiteBounds(context.root))
		return diagnostic(Code.InvalidRootBounds, 'The root canvas has invalid dimensions.', {
			regionId: candidate.rootId,
		});
	if (candidate.regions.length !== context.model.preorderIds.length - 1)
		return diagnostic(
			Code.ChildRegionInventory,
			'The composed canvas does not contain each child region exactly once.',
		);
	if (context.placements.size !== candidate.regions.length)
		return diagnostic(
			Code.RepeatedChildRegion,
			'The composed canvas repeats a child region identity.',
		);
	for (const region of candidate.regions)
		if (!context.model.regionsById.has(region.id))
			return diagnostic(
				Code.UnknownChildRegion,
				`Child region ${region.id} is not in the region model.`,
				{
					regionId: region.id,
				},
			);
	return undefined;
}

function regionPlacementFailure(
	id: string,
	context: GeometryContext,
): RegionGeometryDiagnostic | undefined {
	const region = context.placements.get(id);
	const expected = context.model.regionsById.get(id);
	if (region === undefined || expected === undefined)
		return diagnostic(
			Code.MissingChildRegion,
			`Child region ${id} is missing from the composed canvas.`,
			{
				regionId: id,
			},
		);
	if (region.parentId !== expected.parentId)
		return diagnostic(Code.WrongChildParent, `Child region ${id} has the wrong parent.`, {
			regionId: id,
			relatedRegionId: region.parentId,
		});
	let parent: Bounds | undefined = context.root;
	if (region.parentId !== context.model.rootId)
		parent = context.placements.get(region.parentId)?.bounds;
	const invalidBounds = !finiteBounds(region.bounds);
	const outsideParent = parent !== undefined && !inside(parent, region.bounds);
	if (parent === undefined || invalidBounds || outsideParent)
		return diagnostic(Code.ChildOutsideParent, `Child region ${id} is outside its parent.`, {
			regionId: id,
			relatedRegionId: region.parentId,
		});
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

function siblingOverlapFailure(context: GeometryContext): RegionGeometryDiagnostic | undefined {
	for (const parent of context.model.regionsById.values()) {
		const siblings = parent.childIds.map((id) => defined(context.placements.get(id)));
		if (siblingsOverlap(siblings))
			return diagnostic(Code.OverlappingChildren, `Children of region ${parent.id} overlap.`, {
				regionId: parent.id,
			});
	}
	return undefined;
}

function placementFailure(
	candidate: RegionCompositionGeometryCandidate,
	context: GeometryContext,
): RegionGeometryDiagnostic | undefined {
	const inventory = placementInventoryFailure(candidate, context);
	if (inventory !== undefined) return inventory;
	for (const id of context.model.preorderIds) {
		if (id === context.model.rootId) continue;
		const failure = regionPlacementFailure(id, context);
		if (failure !== undefined) return failure;
	}
	return siblingOverlapFailure(context);
}

/** Validate every boundary in the normalized leaf → LCA → leaf route chain. */
export function validateRegionCompositionGeometry(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
	bridgeCache?: RouteBridgeCache,
): RegionGeometryDiagnostic | undefined {
	const placements = new Map(candidate.regions.map((region) => [region.id, region]));
	const root = {
		x: 0,
		y: 0,
		width: candidate.layout.width,
		height: candidate.layout.height,
	};
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
		return diagnostic(
			Code.RelationInventory,
			'The composed canvas does not contain each relation exactly once.',
		);
	if (candidate.layout.relations.some(({ id }) => !relationIds.has(id)))
		return diagnostic(Code.UnknownRelation, 'The composed canvas has an unknown relation.');
	if (candidate.ownedRoutes.some(({ relationId }) => !relationIds.has(relationId)))
		return diagnostic(Code.UnknownOwnedRouteRelation, 'An owned route has an unknown relation.');
	if (candidate.portals.some(({ relationId }) => !relationIds.has(relationId)))
		return diagnostic(Code.UnknownPortalRelation, 'A boundary portal has an unknown relation.');
	for (const owned of model.relations) {
		const failure = relationFailure(owned, candidate, context);
		if (failure !== undefined) return failure;
	}
	const bridges = validatedBridgesCached(candidate.layout.relations, bridgeCache);
	return diagnoseParentRouteContacts(
		model,
		candidate.ownedRoutes,
		candidate.layout.relations,
		bridges,
	);
}

/** Display adapter for callers that only need the established wording. */
export function validateRegionCompositionGeometryMessage(
	model: RegionCompositionModel,
	candidate: RegionCompositionGeometryCandidate,
): string | undefined {
	return validateRegionCompositionGeometry(model, candidate)?.message;
}

import { defined } from '../../../document/logic-document';
import {
	orthogonal,
	samePoint,
	segmentEnters,
	within,
} from '../../geometry/nested-region-geometry-primitives';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic as diagnostic,
	RegionGeometryDiagnosticCode as Code,
} from '../../geometry/region-geometry-diagnostic';
import type { Bounds, Point } from '../../layout-types';
import type {
	RegionCompositionModel,
	RegionRelationOwnership,
} from '../model/region-composition-model';
import {
	type RegionOwnedRoute,
	type RegionPortal,
	RegionPortalSide,
} from '../model/region-composition-types';
import type {
	RegionCompositionGeometryCandidate,
	RegionGeometryPlacement,
} from './region-composition-validation-types';

export interface GeometryContext {
	readonly model: RegionCompositionModel;
	readonly placements: ReadonlyMap<string, RegionGeometryPlacement>;
	readonly root: Bounds;
}

function strictlyBetween(value: number, minimum: number, maximum: number): boolean {
	return value > minimum && value < maximum;
}

function sameCoordinate(left: number, right: number): boolean {
	return Math.abs(left - right) <= 1e-6;
}

function portalOnBoundary(portal: RegionPortal, region: RegionGeometryPlacement): boolean {
	const { x, y, width, height } = region.bounds;
	const point = portal.point;
	if (!sameCoordinate(portal.localPoint.x, point.x - x)) return false;
	if (!sameCoordinate(portal.localPoint.y, point.y - y)) return false;
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

function validPortal(
	portal: RegionPortal,
	expectedRegionId: string,
	expectedEndpointId: string,
	region: RegionGeometryPlacement | undefined,
): boolean {
	if (region === undefined) return false;
	if (portal.regionId !== expectedRegionId) return false;
	if (portal.endpointId !== expectedEndpointId) return false;
	return portalOnBoundary(portal, region);
}

function ownedPieceFailure(
	relationId: string,
	piece: RegionOwnedRoute,
	context: GeometryContext,
): RegionGeometryDiagnostic | undefined {
	if (!orthogonal(piece.points))
		return diagnostic(
			Code.NonOrthogonalOwnedPiece,
			`Relation ${relationId} has a non-orthogonal owned piece.`,
			{
				relationId,
				regionId: piece.regionId,
			},
		);
	const owner = context.model.regionsById.get(piece.regionId);
	if (owner === undefined)
		return diagnostic(
			Code.UnknownRouteOwner,
			`Relation ${relationId} has an unknown route owner.`,
			{
				relationId,
				regionId: piece.regionId,
			},
		);
	let bounds: Bounds | undefined = context.root;
	if (piece.regionId !== context.model.rootId)
		bounds = context.placements.get(piece.regionId)?.bounds;
	if (bounds === undefined || piece.points.some((point) => !within(bounds, point)))
		return diagnostic(
			Code.OwnedPieceOutsideRegion,
			`Relation ${relationId} leaves its owning region ${piece.regionId}.`,
			{ relationId, regionId: piece.regionId },
		);
	for (const childId of owner.childIds) {
		const child = context.placements.get(childId);
		if (child !== undefined && segmentEnters(piece.points, child.bounds))
			return diagnostic(
				Code.OwnedPieceEntersOpaqueChild,
				`Relation ${relationId} enters opaque child ${childId} from owner ${piece.regionId}.`,
				{ relationId, regionId: piece.regionId, relatedRegionId: childId },
			);
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
): RegionGeometryDiagnostic | undefined {
	const owners = expectedOwners(owned);
	if (pieces.length !== owners.length)
		return diagnostic(
			Code.OwnedPieceInventory,
			`Relation ${owned.relation.id} has a missing or extra owned piece.`,
			{ relationId: owned.relation.id, regionId: owned.ownerId },
		);
	for (const [index, piece] of pieces.entries()) {
		if (piece.regionId !== owners[index])
			return diagnostic(
				Code.WrongBoundaryOwner,
				`Relation ${owned.relation.id} has a wrong boundary owner.`,
				{
					relationId: owned.relation.id,
					regionId: piece.regionId,
					relatedRegionId: defined(owners[index]),
				},
			);
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
): RegionGeometryDiagnostic | undefined {
	const { relation } = owned;
	const boundaryIds = expectedPortalRegions(owned);
	if (portals.length !== boundaryIds.length)
		return diagnostic(
			Code.PortalInventory,
			`Relation ${relation.id} has a missing or extra boundary portal.`,
			{
				relationId: relation.id,
				regionId: owned.ownerId,
			},
		);
	for (const [index, portal] of portals.entries()) {
		const expectedId = defined(boundaryIds[index]);
		let expectedEndpoint = relation.to;
		if (index < owned.sourcePathToOwner.length) expectedEndpoint = relation.from;
		const region = context.placements.get(expectedId);
		if (!validPortal(portal, expectedId, expectedEndpoint, region))
			return diagnostic(
				Code.InvalidBoundaryPortal,
				`Relation ${relation.id} has an invalid boundary portal.`,
				{
					relationId: relation.id,
					regionId: portal.regionId,
					endpointId: portal.endpointId,
					relatedRegionId: expectedId,
				},
			);
		const before = defined(pieces[index]);
		const after = defined(pieces[index + 1]);
		const beforeEnd = defined(before.points.at(-1));
		const afterStart = defined(after.points[0]);
		if (!samePoint(beforeEnd, portal.point) || !samePoint(afterStart, portal.point))
			return diagnostic(
				Code.DisconnectedBoundaryPortal,
				`Relation ${relation.id} has a disconnected boundary portal.`,
				{
					relationId: relation.id,
					regionId: portal.regionId,
					endpointId: portal.endpointId,
				},
			);
	}
	return undefined;
}

export function relationFailure(
	owned: RegionRelationOwnership,
	candidate: RegionCompositionGeometryCandidate,
	context: GeometryContext,
): RegionGeometryDiagnostic | undefined {
	const { relation } = owned;
	const route = candidate.layout.relations.find(({ id }) => id === relation.id);
	const matchingRoute = route?.from === relation.from && route.to === relation.to;
	if (!matchingRoute)
		return diagnostic(
			Code.InvalidComposedRoute,
			`Relation ${relation.id} has no valid composed route.`,
			{
				relationId: relation.id,
				regionId: owned.ownerId,
			},
		);
	const pieces = candidate.ownedRoutes.filter(({ relationId }) => relationId === relation.id);
	const ownerFailure = ownedChainFailure(owned, pieces, context);
	if (ownerFailure !== undefined) return ownerFailure;
	if (!orthogonal(route.points))
		return diagnostic(
			Code.InvalidComposedRoute,
			`Relation ${relation.id} has no valid composed route.`,
			{
				relationId: relation.id,
				regionId: owned.ownerId,
			},
		);
	const portals = candidate.portals.filter(({ relationId }) => relationId === relation.id);
	const portalFailure = portalChainFailure(owned, pieces, portals, context);
	if (portalFailure !== undefined) return portalFailure;
	const joined = stitched(pieces);
	if (joined.length !== route.points.length)
		return diagnostic(
			Code.OwnedPiecesMismatch,
			`Relation ${relation.id} differs from its owned pieces.`,
			{
				relationId: relation.id,
				regionId: owned.ownerId,
			},
		);
	if (joined.some((point, index) => !samePoint(point, defined(route.points[index]))))
		return diagnostic(
			Code.OwnedPiecesMismatch,
			`Relation ${relation.id} differs from its owned pieces.`,
			{
				relationId: relation.id,
				regionId: owned.ownerId,
			},
		);
	return undefined;
}

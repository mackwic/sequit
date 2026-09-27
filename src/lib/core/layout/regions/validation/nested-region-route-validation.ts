import { defined, type LogicRelation } from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import { unbridgedContacts } from '../../bridges/bridge-contact';
import { validatedBridges } from '../../bridges/bridge-oracle';
import {
	orthogonal,
	samePoint,
	segmentEnters,
	within,
} from '../../geometry/nested-region-geometry-primitives';
import type { Bounds, LayoutRelation, Point } from '../../layout-types';
import {
	type RegionChildPlacement,
	type RegionInput,
	type RegionLayoutSelected,
	type RegionOwnedRoute,
	type RegionPortal,
	RegionPortalSide,
} from '../model/region-composition-types';
import { incidentAnchorOnFace } from './nested-region-leaf-incident-validation';

function portalOnBoundary(portal: RegionPortal, region: RegionChildPlacement): boolean {
	if (portal.regionId !== region.id) return false;
	let y = region.bounds.y;
	let localY = 0;
	if (portal.side === RegionPortalSide.Bottom) {
		y += region.bounds.height;
		localY = region.bounds.height;
	}
	if (portal.point.y !== y) return false;
	if (portal.point.x <= region.bounds.x) return false;
	if (portal.point.x >= region.bounds.x + region.bounds.width) return false;
	if (portal.localPoint.x !== portal.point.x - region.bounds.x) return false;
	return portal.localPoint.y === localY;
}

function endpointOnPortalSide(
	point: Point,
	bounds: Bounds | undefined,
	side: RegionPortalSide,
): boolean {
	return bounds !== undefined && incidentAnchorOnFace(point, bounds, side);
}

function portalConnectionFailure(
	relationId: string,
	owners: readonly RegionOwnedRoute[],
	source: RegionPortal,
	target: RegionPortal,
): string | undefined {
	const parent = defined(owners[1]);
	if (!samePoint(defined(owners[0]).points.at(-1) ?? { x: NaN, y: NaN }, source.point))
		return `Relation ${relationId} has a disconnected source portal.`;
	if (!samePoint(parent.points[0] ?? { x: NaN, y: NaN }, source.point))
		return `Relation ${relationId} has a disconnected parent route.`;
	// The preceding source connection proves that this parent piece is nonempty.
	if (!samePoint(defined(parent.points.at(-1)), target.point))
		return `Relation ${relationId} has a disconnected target portal.`;
	if (!samePoint(defined(owners[2]).points[0] ?? { x: NaN, y: NaN }, target.point))
		return `Relation ${relationId} has a disconnected target route.`;
	return undefined;
}

function incidentPortalFailure(
	relation: LogicRelation,
	owners: readonly RegionOwnedRoute[],
	candidate: RegionLayoutSelected,
	input: RegionInput,
): string | undefined {
	const sourceRegion = candidate.regions.find(
		({ id }) => id === input.regionByEndpointId.get(relation.from),
	);
	const targetRegion = candidate.regions.find(
		({ id }) => id === input.regionByEndpointId.get(relation.to),
	);
	const portals = candidate.portals.filter(({ relationId }) => relationId === relation.id);
	if (sourceRegion === undefined || targetRegion === undefined)
		return `Relation ${relation.id} has a missing incident portal.`;
	if (portals.length !== 2) return `Relation ${relation.id} has a missing incident portal.`;
	const source = defined(portals[0]);
	const target = defined(portals[1]);
	if (!portalOnBoundary(source, sourceRegion) || !portalOnBoundary(target, targetRegion))
		return `Relation ${relation.id} has a portal outside its owning boundary.`;
	if (source.endpointId !== relation.from || target.endpointId !== relation.to)
		return `Relation ${relation.id} has an incident portal for the wrong endpoint.`;
	return portalConnectionFailure(relation.id, owners, source, target);
}

function routeMatchesOwners(route: LayoutRelation, owners: readonly RegionOwnedRoute[]): boolean {
	const stitched: Point[] = [];
	for (const owner of owners) {
		if (stitched.length > 0) stitched.push(...owner.points.slice(1));
		else stitched.push(...owner.points);
	}
	if (stitched.length !== route.points.length) return false;
	return stitched.every((point, index) => {
		const expected = route.points[index];
		return expected !== undefined && samePoint(point, expected);
	});
}

interface RelationRegions {
	readonly sourceId: string | undefined;
	readonly targetId: string | undefined;
	readonly local: boolean;
}

function relationRegions(relation: LogicRelation, input: RegionInput): RelationRegions {
	const sourceId = input.regionByEndpointId.get(relation.from);
	const targetId = input.regionByEndpointId.get(relation.to);
	return { sourceId, targetId, local: sourceId === targetId };
}

function ownershipFailure(
	relation: LogicRelation,
	owners: readonly RegionOwnedRoute[],
	candidate: RegionLayoutSelected,
	input: RegionInput,
): string | undefined {
	const regions = relationRegions(relation, input);
	if (regions.local) {
		if (owners.length !== 1 || defined(owners[0]).regionId !== regions.sourceId)
			return `Local relation ${relation.id} has the wrong owner.`;
		return undefined;
	}
	if (owners.length !== 3) return `Relation ${relation.id} has no composed route.`;
	if (
		defined(owners[0]).regionId !== regions.sourceId ||
		defined(owners[2]).regionId !== regions.targetId
	)
		return `Relation ${relation.id} has the wrong incident child owner.`;
	if (defined(owners[1]).regionId !== candidate.rootId)
		return `Relation ${relation.id} is not owned by its least common ancestor.`;
	return incidentPortalFailure(relation, owners, candidate, input);
}

function localRouteFailure(
	relation: LogicRelation,
	owners: readonly RegionOwnedRoute[],
	candidate: RegionLayoutSelected,
	input: RegionInput,
): string | undefined {
	const regions = relationRegions(relation, input);
	if (!regions.local) return undefined;
	const region = candidate.regions.find(({ id }) => id === regions.sourceId);
	const local = region?.localLayout.relations.find(({ id }) => id === relation.id);
	if (region === undefined || local === undefined)
		return `Local relation ${relation.id} is absent from its child layout.`;
	const owner = defined(owners[0]);
	const expected = local.points.map(({ x, y }) => ({
		x: x + region.translation.x,
		y: y + region.translation.y,
	}));
	if (expected.length !== owner.points.length)
		return `Local relation ${relation.id} was changed during composition.`;
	if (expected.some((point, index) => !samePoint(point, defined(owner.points[index]))))
		return `Local relation ${relation.id} was changed during composition.`;
	return undefined;
}

function ownedSegmentFailure(
	relation: LogicRelation,
	owner: RegionOwnedRoute,
	candidate: RegionLayoutSelected,
): string | undefined {
	if (owner.regionId === candidate.rootId) {
		if (candidate.regions.some(({ bounds }) => segmentEnters(owner.points, bounds)))
			return `Parent route ${relation.id} enters an opaque child.`;
		return undefined;
	}
	const region = defined(candidate.regions.find(({ id }) => id === owner.regionId));
	if (owner.points.some((point) => !within(region.bounds, point)))
		return `Route ${relation.id} leaves its owning child.`;
	return undefined;
}

function relationFailure(
	relation: LogicRelation,
	candidate: RegionLayoutSelected,
	input: RegionInput,
): string | undefined {
	const route = candidate.layout.relations.find(({ id }) => id === relation.id);
	if (route === undefined || !orthogonal(route.points))
		return `Relation ${relation.id} has no valid orthogonal route.`;
	const owners = candidate.ownedRoutes.filter(({ relationId }) => relationId === relation.id);
	const ownership = ownershipFailure(relation, owners, candidate, input);
	if (ownership !== undefined) return ownership;
	if (!routeMatchesOwners(route, owners))
		return `Relation ${relation.id} differs from its owned route pieces.`;
	const local = localRouteFailure(relation, owners, candidate, input);
	if (local !== undefined) return local;
	for (const owner of owners) {
		const failure = ownedSegmentFailure(relation, owner, candidate);
		if (failure !== undefined) return failure;
	}
	for (const element of candidate.layout.elements) {
		if (element.id === relation.from || element.id === relation.to) continue;
		if (segmentEnters(route.points, element.bounds))
			return `Relation ${relation.id} crosses unrelated node ${element.id}.`;
	}
	const sourceBounds = candidate.layout.elements.find(({ id }) => id === relation.from)?.bounds;
	const targetBounds = candidate.layout.elements.find(({ id }) => id === relation.to)?.bounds;
	if (input.regionByEndpointId.get(relation.from) === input.regionByEndpointId.get(relation.to))
		return undefined;
	const sourceSide = candidate.portals.find(
		({ relationId, endpointId }) => relationId === relation.id && endpointId === relation.from,
	)?.side;
	const targetSide = candidate.portals.find(
		({ relationId, endpointId }) => relationId === relation.id && endpointId === relation.to,
	)?.side;
	// Orthogonality establishes both route endpoints; portal ownership establishes each side.
	if (!endpointOnPortalSide(defined(route.points[0]), sourceBounds, defined(sourceSide)))
		return `Relation ${relation.id} does not attach to its source port.`;
	if (!endpointOnPortalSide(defined(route.points.at(-1)), targetBounds, defined(targetSide)))
		return `Relation ${relation.id} does not attach to its target port.`;
	return undefined;
}

export function validateNestedRouteOwnership(
	graph: LogicGraph,
	input: RegionInput,
	candidate: RegionLayoutSelected,
): string | undefined {
	if (candidate.layout.elements.length !== graph.document.nodes.length)
		return 'The composed canvas does not contain each source node exactly once.';
	if (candidate.layout.relations.length !== graph.relations.length)
		return 'The composed canvas does not contain each source relation exactly once.';
	for (const { relation } of graph.relations) {
		const failure = relationFailure(relation, candidate, input);
		if (failure !== undefined) return failure;
	}
	const parentRoutes = candidate.ownedRoutes.filter(
		({ regionId }) => regionId === candidate.rootId,
	);
	const bridges = validatedBridges(candidate.layout.relations);
	for (let index = 0; index < parentRoutes.length; index += 1) {
		const current = defined(parentRoutes[index]);
		for (const other of parentRoutes.slice(index + 1)) {
			const unbridged = unbridgedContacts(
				{ id: current.relationId, points: current.points },
				{ id: other.relationId, points: other.points },
				bridges,
			);
			if (unbridged.length > 0)
				return `Parent routes ${current.relationId} and ${other.relationId} intersect without a bridge.`;
		}
	}
	return undefined;
}

import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import { disallowedProvisionalRouteContacts, type EndpointRoute } from '../bridges/bridge-contact';
import { inside, segmentEnters } from '../geometry/nested-region-geometry-primitives';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../geometry/region-geometry-diagnostic';
import type { LayoutElement, LayoutRelation, Point } from '../layout-types';
import { routeCandidates } from '../regions/leaf/region-leaf-incident-geometry';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import { samePoint } from './grid-cell-geometry-primitives';
import type { GridCellPlacement } from './grid-cell-types';

/** One end of a crossing inside its own cell: from its port to the cell portal side. */
export interface GridCellIncident {
	readonly relationId: string;
	readonly endpointId: string;
	readonly source: boolean;
	readonly cell: GridCellPlacement;
	readonly side: RegionPortalSide.Left | RegionPortalSide.Right;
	/** Global port on the endpoint's face. */
	readonly port: Point;
	/**
	 * The endpoint lies in a nested region of its cell, whose frame the grid cannot port: only the
	 * direct attachment is proposed and the composition validator decides.
	 */
	readonly nested: boolean;
}

/** A route with its closed point box: routes whose boxes neither meet nor touch cannot contact. */
interface BoxedRoute {
	readonly route: EndpointRoute;
	readonly low: Point;
	readonly high: Point;
}

function boxed(route: EndpointRoute): BoxedRoute {
	const low = { x: Infinity, y: Infinity };
	const high = { x: -Infinity, y: -Infinity };
	for (const { x, y } of route.points) {
		low.x = Math.min(low.x, x);
		low.y = Math.min(low.y, y);
		high.x = Math.max(high.x, x);
		high.y = Math.max(high.y, y);
	}
	return { route, low, high };
}

/** A cell's boxes and local routes in grid coordinates: what its crossing pieces must avoid. */
interface CellObstacles {
	readonly elements: readonly LayoutElement[];
	readonly relations: readonly BoxedRoute[];
}

function translated(point: Point, delta: Point): Point {
	return { x: point.x + delta.x, y: point.y + delta.y };
}

/** Placed cells never change: their obstacles are translated once for every allocation. */
const obstaclesByCell = new WeakMap<GridCellPlacement, CellObstacles>();

function cellObstacles(cell: GridCellPlacement): CellObstacles {
	const cached = obstaclesByCell.get(cell);
	if (cached !== undefined) return cached;
	const { translation } = cell;
	const obstacles = {
		elements: cell.localLayout.elements.map((element) => ({
			...element,
			bounds: { ...element.bounds, ...translated(element.bounds, translation) },
		})),
		relations: cell.localLayout.relations.map((relation) =>
			boxed({
				...relation,
				points: relation.points.map((point) => translated(point, translation)),
			}),
		),
	};
	obstaclesByCell.set(cell, obstacles);
	return obstacles;
}

/** The piece as the contact oracle reads it: a target piece ends on its endpoint's port. */
function incidentRoute(incident: GridCellIncident, points: readonly Point[]): EndpointRoute {
	if (incident.source) return { id: incident.relationId, points, from: incident.endpointId };
	return { id: incident.relationId, points: [...points].reverse(), to: incident.endpointId };
}

/**
 * A direct attachment may leave the groups containing its endpoint; a detour may not, as the
 * composition validator only lets a direct attachment exit a containing group.
 */
function entersElement(
	incident: GridCellIncident,
	points: readonly Point[],
	obstacles: CellObstacles,
): boolean {
	const endpoint = obstacles.elements.find(({ id }) => id === incident.endpointId);
	return obstacles.elements.some((element) => {
		if (element.id === incident.endpointId) return false;
		const containing = endpoint !== undefined && inside(element.bounds, endpoint.bounds);
		if (containing && points.length === 2) return false;
		return segmentEnters(points, element.bounds);
	});
}

function spansMeet(first: BoxedRoute, second: BoxedRoute): boolean {
	if (first.low.x > second.high.x || second.low.x > first.high.x) return false;
	return first.low.y <= second.high.y && second.low.y <= first.high.y;
}

/** The first route a piece overlaps or T-touches; strict crossings wait for the bridges. */
function firstContact(piece: BoxedRoute, others: readonly BoxedRoute[]): EndpointRoute | undefined {
	return others.find(
		(other) =>
			spansMeet(piece, other) &&
			disallowedProvisionalRouteContacts(piece.route, other.route).length > 0,
	)?.route;
}

function clear(
	incident: GridCellIncident,
	points: readonly Point[],
	obstacles: CellObstacles,
	earlier: readonly BoxedRoute[],
): boolean {
	if (entersElement(incident, points, obstacles)) return false;
	const piece = boxed(incidentRoute(incident, points));
	if (firstContact(piece, obstacles.relations) !== undefined) return false;
	return firstContact(piece, earlier) === undefined;
}

/**
 * The direct attachment when it is clear, else the leaf router's corridors with the cell frame as
 * canvas, at `CORRIDOR_CLEARANCE` from the face. Without a clear one the direct attachment stays,
 * and the grid validator names the obstacle.
 */
function routeIncident(
	incident: GridCellIncident,
	obstacles: CellObstacles,
	earlier: readonly BoxedRoute[],
): readonly Point[] {
	const { bounds } = incident.cell;
	let portalX = bounds.x;
	if (incident.side === RegionPortalSide.Right) portalX += bounds.width;
	const direct = [incident.port, { x: portalX, y: incident.port.y }];
	if (incident.nested || clear(incident, direct, obstacles, earlier)) return direct;
	const anchor = { x: incident.port.x - bounds.x, y: incident.port.y - bounds.y };
	const canvas = { width: bounds.width, height: bounds.height, elements: [], relations: [] };
	const corridors = routeCandidates(anchor, incident.side, canvas)
		.slice(1)
		.map((points) => [incident.port, ...points.slice(1).map((point) => translated(point, bounds))]);
	return corridors.find((points) => clear(incident, points, obstacles, earlier)) ?? direct;
}

function compareIncidents(left: GridCellIncident, right: GridCellIncident): number {
	const vertical = left.port.y - right.port.y;
	if (vertical !== 0) return vertical;
	const horizontal = left.port.x - right.port.x;
	if (horizontal !== 0) return horizontal;
	return compareCanonicalStrings(left.relationId, right.relationId);
}

/**
 * Route every crossing end from its port to its cell portal, inside its own cell, in port order:
 * each cell's incidents avoid its other elements, its local routes and the incidents already
 * routed there. Returns the pieces, port first, in the order of `incidents`.
 */
export function routeGridCellIncidents(
	incidents: readonly GridCellIncident[],
): readonly (readonly Point[])[] {
	const earlierByCell = new Map<string, BoxedRoute[]>();
	const pieces: (readonly Point[])[] = [];
	const order = incidents.map((_, index) => index);
	order.sort((left, right) =>
		compareIncidents(defined(incidents[left]), defined(incidents[right])),
	);
	for (const index of order) {
		const incident = defined(incidents[index]);
		const earlier = earlierByCell.get(incident.cell.id) ?? [];
		earlierByCell.set(incident.cell.id, earlier);
		const piece = routeIncident(incident, cellObstacles(incident.cell), earlier);
		earlier.push(boxed(incidentRoute(incident, piece)));
		pieces[index] = piece;
	}
	return pieces;
}

/** Segments before `sourceEnd` lie in the source cell, from `targetStart` in the target cell. */
export interface IncidentPieceEnds {
	readonly sourceEnd: number;
	readonly targetStart: number;
}

/**
 * The indices of a crossing route's source portal (end of the source cell piece) and target portal
 * (start of the target cell piece), or undefined when the route does not reach both in order.
 */
export function incidentPieceEnds(
	points: readonly Point[],
	sourcePortal: Point,
	targetPortal: Point,
): IncidentPieceEnds | undefined {
	const sourceEnd = points.findIndex((point, index) => index > 0 && samePoint(point, sourcePortal));
	let targetStart = points.length - 2;
	while (targetStart >= 0 && !samePoint(defined(points[targetStart]), targetPortal))
		targetStart -= 1;
	if (sourceEnd < 0 || targetStart < sourceEnd) return undefined;
	return { sourceEnd, targetStart };
}

function pieceFailure(
	piece: BoxedRoute,
	cellId: string,
	obstacles: CellObstacles,
	earlier: readonly BoxedRoute[],
): RegionGeometryDiagnostic | undefined {
	const { id } = piece.route;
	const local = firstContact(piece, obstacles.relations);
	if (local !== undefined)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.IncidentTouchesLocalRelation,
			`Cross-cell relation ${id} touches local relation ${local.id} in cell ${cellId}.`,
			{ relationId: id, regionId: cellId, relatedRelationId: local.id },
		);
	const other = firstContact(piece, earlier);
	if (other === undefined) return undefined;
	return regionGeometryDiagnostic(
		RegionGeometryDiagnosticCode.IncidentTouchesIncident,
		`Cross-cell relation ${id} touches crossing ${other.id} in cell ${cellId}.`,
		{ relationId: id, regionId: cellId, relatedRelationId: other.id },
	);
}

/** A crossing route whose portals the validator accepted, with its cells and piece bounds. */
export interface GridCrossingPieces extends IncidentPieceEnds {
	readonly route: LayoutRelation;
	readonly sourceCell: GridCellPlacement;
	readonly targetCell: GridCellPlacement;
}

/**
 * The in-cell pieces of the crossings, checked as the composition validator checks leaf incidents:
 * no overlap or T-contact with the cell's local routes or another piece in the same cell. Strict
 * crossings wait for the complete candidate's bridges.
 */
export function gridIncidentPieceFailure(
	crossings: readonly GridCrossingPieces[],
): RegionGeometryDiagnostic | undefined {
	const earlierByCell = new Map<string, BoxedRoute[]>();
	const check = (cell: GridCellPlacement, piece: BoxedRoute) => {
		const earlier = earlierByCell.get(cell.id) ?? [];
		earlierByCell.set(cell.id, earlier);
		const failure = pieceFailure(piece, cell.id, cellObstacles(cell), earlier);
		earlier.push(piece);
		return failure;
	};
	for (const { route, sourceCell, targetCell, sourceEnd, targetStart } of crossings) {
		const { id, from, to, points } = route;
		const source = boxed({ id, points: points.slice(0, sourceEnd + 1), from });
		const failure =
			check(sourceCell, source) ??
			check(targetCell, boxed({ id, points: points.slice(targetStart), to }));
		if (failure !== undefined) return failure;
	}
	return undefined;
}

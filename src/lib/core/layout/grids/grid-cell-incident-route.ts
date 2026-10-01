import { compareCanonicalStrings } from '../../canonical-string';
import { defined, type LogicRelation } from '../../document/logic-document';
import { disallowedProvisionalRouteContacts, type EndpointRoute } from '../bridges/bridge-contact';
import { inside, segmentEnters } from '../geometry/nested-region-geometry-primitives';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../geometry/region-geometry-diagnostic';
import type { LayoutElement, Point } from '../layout-types';
import { routeCandidates } from '../regions/leaf/region-leaf-incident-geometry';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import { samePoint } from './grid-cell-geometry-primitives';
import type { GridCellPlacement, GridCellSelected } from './grid-cell-types';

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

/** A cell's boxes and local routes in grid coordinates: what its crossing pieces must avoid. */
export interface CellObstacles {
	readonly elements: readonly LayoutElement[];
	readonly relations: readonly EndpointRoute[];
}

function translated(point: Point, delta: Point): Point {
	return { x: point.x + delta.x, y: point.y + delta.y };
}

export function cellObstacles(cell: GridCellPlacement): CellObstacles {
	const { translation } = cell;
	return {
		elements: cell.localLayout.elements.map((element) => ({
			...element,
			bounds: { ...element.bounds, ...translated(element.bounds, translation) },
		})),
		relations: cell.localLayout.relations.map((relation) => ({
			...relation,
			points: relation.points.map((point) => translated(point, translation)),
		})),
	};
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

/** Closed point spans: routes whose spans neither meet nor touch cannot contact each other. */
function spansMeet(first: readonly Point[], second: readonly Point[]): boolean {
	const [left, right] = [first, second].map((points) => ({
		low: { x: Math.min(...points.map(({ x }) => x)), y: Math.min(...points.map(({ y }) => y)) },
		high: { x: Math.max(...points.map(({ x }) => x)), y: Math.max(...points.map(({ y }) => y)) },
	}));
	const { low, high } = defined(left);
	const other = defined(right);
	if (low.x > other.high.x || other.low.x > high.x) return false;
	return low.y <= other.high.y && other.low.y <= high.y;
}

/** The first route a piece overlaps or T-touches; strict crossings wait for the bridges. */
function firstContact(
	route: EndpointRoute,
	others: readonly EndpointRoute[],
): EndpointRoute | undefined {
	return others.find(
		(other) =>
			spansMeet(route.points, other.points) &&
			disallowedProvisionalRouteContacts(route, other).length > 0,
	);
}

function clear(
	incident: GridCellIncident,
	points: readonly Point[],
	obstacles: CellObstacles,
	earlier: readonly EndpointRoute[],
): boolean {
	if (entersElement(incident, points, obstacles)) return false;
	const route = incidentRoute(incident, points);
	if (firstContact(route, obstacles.relations) !== undefined) return false;
	return firstContact(route, earlier) === undefined;
}

/**
 * The direct attachment when it is clear, else the leaf router's corridors with the cell frame as
 * canvas, at `CORRIDOR_CLEARANCE` from the face. Without a clear one the direct attachment stays,
 * and the grid validator names the obstacle.
 */
function routeIncident(
	incident: GridCellIncident,
	obstacles: CellObstacles,
	earlier: readonly EndpointRoute[],
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
	obstaclesByCellId: ReadonlyMap<string, CellObstacles>,
	incidents: readonly GridCellIncident[],
): readonly (readonly Point[])[] {
	const earlierByCell = new Map<string, EndpointRoute[]>();
	const pieces: (readonly Point[])[] = [];
	const order = incidents.map((_, index) => index);
	order.sort((left, right) =>
		compareIncidents(defined(incidents[left]), defined(incidents[right])),
	);
	for (const index of order) {
		const incident = defined(incidents[index]);
		const cellId = incident.cell.id;
		const obstacles = defined(obstaclesByCellId.get(cellId));
		const earlier = earlierByCell.get(cellId) ?? [];
		earlierByCell.set(cellId, earlier);
		const piece = routeIncident(incident, obstacles, earlier);
		earlier.push(incidentRoute(incident, piece));
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
	const first = (path: readonly Point[], portal: Point) =>
		path.findIndex((point, index) => index > 0 && samePoint(point, portal));
	const sourceEnd = first(points, sourcePortal);
	const fromEnd = first([...points].reverse(), targetPortal);
	const targetStart = points.length - 1 - fromEnd;
	if (sourceEnd < 0 || fromEnd < 0) return undefined;
	if (targetStart < sourceEnd) return undefined;
	return { sourceEnd, targetStart };
}

function pieceFailure(
	route: EndpointRoute,
	cellId: string,
	obstacles: CellObstacles,
	earlier: readonly EndpointRoute[],
): RegionGeometryDiagnostic | undefined {
	const local = firstContact(route, obstacles.relations);
	if (local !== undefined)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.IncidentTouchesLocalRelation,
			`Cross-cell relation ${route.id} touches local relation ${local.id} in cell ${cellId}.`,
			{ relationId: route.id, regionId: cellId, relatedRelationId: local.id },
		);
	const other = firstContact(route, earlier);
	if (other === undefined) return undefined;
	return regionGeometryDiagnostic(
		RegionGeometryDiagnosticCode.IncidentTouchesIncident,
		`Cross-cell relation ${route.id} touches crossing ${other.id} in cell ${cellId}.`,
		{ relationId: route.id, regionId: cellId, relatedRelationId: other.id },
	);
}

/**
 * The in-cell pieces of the crossings, checked as the composition validator checks leaf incidents:
 * no overlap or T-contact with the cell's local routes or another piece in the same cell. Strict
 * crossings wait for the complete candidate's bridges.
 */
export function gridIncidentPieceFailure(
	candidate: GridCellSelected,
	crossing: readonly LogicRelation[],
): RegionGeometryDiagnostic | undefined {
	const routes = new Map(candidate.layout.relations.map((route) => [route.id, route]));
	const cellById = new Map(candidate.cells.map((cell) => [cell.id, cell]));
	const obstaclesByCell = new Map<string, CellObstacles>();
	const earlierByCell = new Map<string, EndpointRoute[]>();
	for (const relation of crossing) {
		const { points } = defined(routes.get(relation.id));
		const [source, target] = candidate.portals.filter(
			({ relationId }) => relationId === relation.id,
		);
		const { sourceEnd, targetStart } = defined(
			incidentPieceEnds(points, defined(source).point, defined(target).point),
		);
		const pieces = [
			{
				cellId: defined(source).cellId,
				points: points.slice(0, sourceEnd + 1),
				from: relation.from,
			},
			{ cellId: defined(target).cellId, points: points.slice(targetStart), to: relation.to },
		];
		for (const { cellId, ...piece } of pieces) {
			const route = { id: relation.id, ...piece };
			const earlier = earlierByCell.get(cellId) ?? [];
			earlierByCell.set(cellId, earlier);
			const obstacles = obstaclesByCell.get(cellId) ?? cellObstacles(defined(cellById.get(cellId)));
			obstaclesByCell.set(cellId, obstacles);
			const failure = pieceFailure(route, cellId, obstacles, earlier);
			if (failure !== undefined) return failure;
			earlier.push(route);
		}
	}
	return undefined;
}

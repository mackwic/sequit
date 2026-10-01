import { compareCanonicalStrings } from '../../canonical-string';
import { defined, type LogicRelation } from '../../document/logic-document';
import { disallowedProvisionalRouteContacts, type EndpointRoute } from '../bridges/bridge-contact';
import { inside, segmentEnters } from '../geometry/nested-region-geometry-primitives';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../geometry/region-geometry-diagnostic';
import type { Bounds, LayoutElement, Point } from '../layout-types';
import { routeCandidates } from '../regions/leaf/region-leaf-incident-geometry';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import { CROSSING_SPACING, crossingPortPositions } from './grid-cell-crossing';
import { equal, samePoint } from './grid-cell-geometry-primitives';
import type { GridCellPlacement, GridCellSelected } from './grid-cell-types';

/** Least distance between a shifted crossing port and a corner of its face. */
const PORT_CORNER_CLEARANCE = CROSSING_SPACING / 2;

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

interface CellObstacles {
	readonly elements: readonly LayoutElement[];
	readonly relations: readonly EndpointRoute[];
}

function translated(point: Point, delta: Point): Point {
	return { x: point.x + delta.x, y: point.y + delta.y };
}

function cellObstacles(cell: GridCellPlacement): CellObstacles {
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

function incidentRoute(incident: GridCellIncident, points: readonly Point[]): EndpointRoute {
	if (incident.source) return { id: incident.relationId, points, from: incident.endpointId };
	return { id: incident.relationId, points, to: incident.endpointId };
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

function clear(
	incident: GridCellIncident,
	points: readonly Point[],
	obstacles: CellObstacles,
	earlier: readonly EndpointRoute[],
): boolean {
	if (entersElement(incident, points, obstacles)) return false;
	const route = incidentRoute(incident, points);
	const touches = (other: EndpointRoute) =>
		disallowedProvisionalRouteContacts(route, other).length > 0;
	return !obstacles.relations.some(touches) && !earlier.some(touches);
}

/**
 * The leaf router's candidates with the cell frame as canvas, so its portal is the cell boundary:
 * the direct attachment first, then corridors at `CORRIDOR_CLEARANCE` from the face. Without a
 * clear one the direct attachment stays, and the grid validator names the obstacle.
 */
function routeIncident(
	incident: GridCellIncident,
	obstacles: CellObstacles,
	earlier: readonly EndpointRoute[],
): readonly Point[] {
	const { bounds } = incident.cell;
	const anchor = { x: incident.port.x - bounds.x, y: incident.port.y - bounds.y };
	const canvas = { width: bounds.width, height: bounds.height, elements: [], relations: [] };
	const candidates = routeCandidates(anchor, incident.side, canvas).map((points) => [
		incident.port,
		...points.slice(1).map((point) => translated(point, bounds)),
	]);
	const direct = defined(candidates[0]);
	if (incident.nested) return direct;
	return candidates.find((points) => clear(incident, points, obstacles, earlier)) ?? direct;
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
	const obstaclesByCell = new Map<string, CellObstacles>();
	const earlierByCell = new Map<string, EndpointRoute[]>();
	const pieces: (readonly Point[])[] = [];
	const order = incidents.map((_, index) => index);
	order.sort((left, right) =>
		compareIncidents(defined(incidents[left]), defined(incidents[right])),
	);
	for (const index of order) {
		const incident = defined(incidents[index]);
		const cellId = incident.cell.id;
		const obstacles = obstaclesByCell.get(cellId) ?? cellObstacles(incident.cell);
		obstaclesByCell.set(cellId, obstacles);
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

function stackInsideFace(ys: readonly number[], face: Bounds): boolean {
	const top = defined(ys[0]) - face.y;
	const bottom = face.y + face.height - defined(ys.at(-1));
	return top >= PORT_CORNER_CLEARANCE && bottom >= PORT_CORNER_CLEARANCE;
}

/**
 * The whole-track shift of an endpoint's crossing port stack. The centred stack stays unless a
 * local relation attaches on one of its points of the portal-side face with a role some crossing
 * of this endpoint does not share: that local family and the crossing would then run together off
 * the face. The nearest free shift inside the face is taken, upwards first; without one the centred
 * stack stays and the validator names the contact.
 */
export function crossingPortShift(
	cell: GridCellPlacement,
	endpointId: string,
	side: RegionPortalSide.Left | RegionPortalSide.Right,
	crossingSources: readonly boolean[],
): number {
	const face = defined(cell.localLayout.elements.find(({ id }) => id === endpointId)).bounds;
	let faceX = face.x;
	if (side === RegionPortalSide.Right) faceX += face.width;
	const foreignRole = (source: boolean) =>
		crossingSources.some((crossingSource) => crossingSource !== source);
	const attached = cell.localLayout.relations
		.flatMap(({ from, to, points }) => [
			{ source: true, own: from === endpointId, end: points[0] },
			{ source: false, own: to === endpointId, end: points.at(-1) },
		])
		.filter(({ own, end }) => own && end !== undefined)
		.filter(({ source, end }) => equal(defined(end).x, faceX) && foreignRole(source))
		.map(({ end }) => defined(end).y);
	const positions = crossingPortPositions(endpointId, face, crossingSources.length);
	const free = (shift: number) =>
		positions.every((y) => !attached.some((attachment) => equal(attachment, y + shift)));
	if (free(0)) return 0;
	const reach = Math.ceil(face.height / CROSSING_SPACING);
	const shifts = Array.from({ length: 2 * reach }, (_, index) => {
		const tracks = Math.floor(index / 2) + 1;
		const upwards = defined([-1, 1][index % 2]);
		return tracks * CROSSING_SPACING * upwards;
	});
	const fits = (shift: number) =>
		stackInsideFace(
			positions.map((y) => y + shift),
			face,
		);
	return shifts.find((shift) => fits(shift) && free(shift)) ?? 0;
}

/** One crossing port: a declared face position, or one moved by whole tracks inside the face. */
export function crossingPortOnFace(face: Bounds, incidenceCount: number, y: number): boolean {
	return crossingPortPositions('', face, incidenceCount).some((position) => {
		const tracks = (y - position) / CROSSING_SPACING;
		if (!equal(tracks, Math.round(tracks))) return false;
		return equal(y, position) || stackInsideFace([y], face);
	});
}

/**
 * The crossing ports of one face, sorted: the centred stack, or that stack moved by whole tracks
 * while every port keeps its clearance from the face corners.
 */
export function validCrossingPortStack(face: Bounds, ys: readonly number[]): boolean {
	const positions = crossingPortPositions('', face, ys.length);
	const shift = defined(ys[0]) - defined(positions[0]);
	const tracks = shift / CROSSING_SPACING;
	if (!equal(tracks, Math.round(tracks))) return false;
	if (!ys.every((y, track) => equal(y - defined(positions[track]), shift))) return false;
	return equal(shift, 0) || stackInsideFace(ys, face);
}

function pieceFailure(
	route: EndpointRoute,
	cellId: string,
	obstacles: CellObstacles,
	earlier: readonly EndpointRoute[],
): RegionGeometryDiagnostic | undefined {
	const touches = (other: EndpointRoute) =>
		disallowedProvisionalRouteContacts(route, other).length > 0;
	const local = obstacles.relations.find(touches);
	if (local !== undefined)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.IncidentTouchesLocalRelation,
			`Cross-cell relation ${route.id} touches local relation ${local.id} in cell ${cellId}.`,
			{ relationId: route.id, regionId: cellId, relatedRelationId: local.id },
		);
	const other = earlier.find(touches);
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
	const obstaclesByCell = new Map(candidate.cells.map((cell) => [cell.id, cellObstacles(cell)]));
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
			const obstacles = defined(obstaclesByCell.get(cellId));
			const failure = pieceFailure(route, cellId, obstacles, earlier);
			if (failure !== undefined) return failure;
			earlierByCell.set(cellId, [...earlier, route]);
		}
	}
	return undefined;
}

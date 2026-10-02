import { defined, type LogicRelation } from '../../document/logic-document';
import type { Bounds, LayoutRelation, Point } from '../layout-types';
import type { RegionOwnedRoute, RegionPortalSide } from '../regions/model/region-composition-types';
import {
	crossingBusY,
	crossingEndpointSide,
	crossingFaceEdge,
	crossingRailX,
	type GridRoutingEdges,
} from './grid-cell-crossing';
import type {
	CrossingPortal,
	CrossingPortalSpan,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';
import {
	type DirectCrossing,
	directCrossings,
	directJog,
	directJogPoints,
	trackRank,
} from './grid-cell-crossing-direct';
import { crossingPortCoordinate, faceLine, facePoint } from './grid-cell-crossing-face';
import { crossingPortShift } from './grid-cell-crossing-port-stack';
import { crossingRowY } from './grid-cell-crossing-resources';
import { incidentPieceEnds, routeGridCellIncidents } from './grid-cell-incident-route';
import type { GridCellInput, GridCellPlacement, GridCellPortal } from './grid-cell-types';

/** The placed cells and the declared tracks a grid region routes its crossings with. */
export interface GridCrossingRoutingInput {
	readonly rootId: string;
	readonly crossing: readonly LogicRelation[];
	readonly columnCount: number;
	readonly cells: readonly GridCellPlacement[];
	readonly cellByEndpointId: GridCellInput['cellByEndpointId'];
	readonly edges: GridRoutingEdges;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
	/** Crossing endpoints lying in a nested region of their cell rather than in the cell itself. */
	readonly nestedEndpointIds: ReadonlySet<string>;
	/**
	 * Route the crossings between neighbouring cells of one row or column through the gap between
	 * them, on the faces looking at each other. Otherwise every crossing takes its column gutters.
	 */
	readonly direct?: boolean;
}

/** What no allocation changes about one face of a crossing endpoint: its cell, side and stack. */
interface CrossingFace {
	readonly cell: GridCellPlacement;
	readonly side: RegionPortalSide;
	/** The endpoint box in grid coordinates. */
	readonly face: Bounds;
	/** The crossings porting on this face, in documentary incidence order. */
	readonly relationIds: readonly string[];
	/** Whole-track shift of the face's port stack off its local families. */
	readonly portShift: number;
	readonly nested: boolean;
}

/** The routing input with what no allocation changes, and the pieces routed so far. */
export interface GridCrossingRouting extends GridCrossingRoutingInput {
	/** The face of each crossing end, by endpoint then relation. */
	readonly faceByEndpointId: ReadonlyMap<string, ReadonlyMap<string, CrossingFace>>;
	/** The crossings routed through the gap between their neighbouring cells. */
	readonly directByRelationId: ReadonlyMap<string, DirectCrossing>;
	/** In-cell pieces by the port points of an allocation, filled during the search. */
	readonly pieceCache: Map<string, readonly (readonly Point[])[]>;
	/** The same pieces by port track table: allocations derived from one another share it. */
	readonly piecesByPortTracks: WeakMap<
		GridCrossingAllocation['portTrackByEndpointId'],
		readonly (readonly Point[])[]
	>;
}

/** The faces of one endpoint: one per side its crossings leave by, each with its own stack. */
function endpointFaces(
	input: GridCrossingRoutingInput,
	endpointId: string,
	cell: GridCellPlacement,
	sideOf: (relationId: string) => RegionPortalSide,
): ReadonlyMap<string, CrossingFace> {
	const local = defined(cell.localLayout.elements.find(({ id }) => id === endpointId)).bounds;
	const face = { ...local, x: local.x + cell.translation.x, y: local.y + cell.translation.y };
	const fromById = new Map(input.crossing.map(({ id, from }) => [id, from]));
	const idsBySide = new Map<RegionPortalSide, string[]>();
	for (const relationId of defined(input.incidence.get(endpointId))) {
		const side = sideOf(relationId);
		const ids = idsBySide.get(side) ?? [];
		ids.push(relationId);
		idsBySide.set(side, ids);
	}
	const faces = new Map<string, CrossingFace>();
	for (const [side, relationIds] of idsBySide) {
		const sources = relationIds.map((id) => fromById.get(id) === endpointId);
		const frame: CrossingFace = {
			cell,
			side,
			face,
			relationIds,
			portShift: crossingPortShift(cell, endpointId, side, sources),
			nested: input.nestedEndpointIds.has(endpointId),
		};
		for (const relationId of relationIds) faces.set(relationId, frame);
	}
	return faces;
}

/** Compute once, before the allocation search, the routing data every allocation shares. */
export function gridCrossingRouting(input: GridCrossingRoutingInput): GridCrossingRouting {
	const cellById = new Map(input.cells.map((cell) => [cell.id, cell]));
	const fromById = new Map(input.crossing.map(({ id, from }) => [id, from]));
	let directByRelationId: ReadonlyMap<string, DirectCrossing> = new Map();
	if (input.direct === true) directByRelationId = directCrossings(input);
	const faceByEndpointId = new Map<string, ReadonlyMap<string, CrossingFace>>();
	for (const endpointId of input.incidence.keys()) {
		const cell = defined(cellById.get(defined(input.cellByEndpointId.get(endpointId))));
		const sideOf = (relationId: string): RegionPortalSide => {
			const direct = directByRelationId.get(relationId);
			if (direct === undefined) return crossingEndpointSide(cell.column, input.columnCount);
			if (fromById.get(relationId) === endpointId) return direct.sourceSide;
			return direct.targetSide;
		};
		faceByEndpointId.set(endpointId, endpointFaces(input, endpointId, cell, sideOf));
	}
	return {
		...input,
		faceByEndpointId,
		directByRelationId,
		pieceCache: new Map(),
		piecesByPortTracks: new WeakMap(),
	};
}

/** The port of one crossing end, read from the allocated port order of its face. */
interface CrossingEndpoint {
	readonly face: CrossingFace;
	readonly endpointId: string;
	readonly port: Point;
}

/** The allocation orders all ports of an endpoint; each face stacks its own in that order. */
function crossingEndpoint(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
	endpointId: string,
): CrossingEndpoint {
	const face = defined(routing.faceByEndpointId.get(endpointId)?.get(relation.id));
	const tracks = defined(allocation.portTrackByEndpointId.get(endpointId));
	const own = defined(tracks.get(relation.id));
	const track = trackRank(face.relationIds, tracks, own);
	const edge = crossingFaceEdge(endpointId, face.relationIds.length);
	const coordinate = crossingPortCoordinate(face.face, face.side, edge, track) + face.portShift;
	return { face, endpointId, port: facePoint(face.face, face.side, coordinate) };
}

function cellPortal(
	relation: LogicRelation,
	endpoint: CrossingEndpoint,
	piece: readonly Point[],
): GridCellPortal {
	const { cell, side } = endpoint.face;
	const point = defined(piece.at(-1));
	return {
		relationId: relation.id,
		endpointId: endpoint.endpointId,
		cellId: cell.id,
		regionId: cell.id,
		side,
		point,
		localPoint: { x: point.x - cell.bounds.x, y: point.y - cell.bounds.y },
	};
}

/** The y of a crossing's horizontal run: its row gutter track when allocated, else the top bus. */
function crossingRunY(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
): number {
	const row = allocation.rowTrackByRelationId?.findIndex((tracks) => tracks.has(relation.id)) ?? -1;
	const rowTrack = allocation.rowTrackByRelationId?.[row]?.get(relation.id);
	if (rowTrack === undefined)
		return crossingBusY(
			routing.edges.topBus,
			defined(allocation.busTrackByRelationId.get(relation.id)),
		);
	const upperCell = defined(routing.cells.find((cell) => cell.row === row));
	return crossingRowY(
		defined(routing.edges.rowGutters[row]),
		upperCell.bounds.y + upperCell.bounds.height,
		rowTrack,
	);
}

/** The x of a crossing's rail in the gutter of a cell's column, at its allocated track. */
function railX(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relationId: string,
	cell: GridCellPlacement,
): number {
	const side = crossingEndpointSide(cell.column, routing.columnCount);
	const edge = defined(routing.edges.gutters[cell.column]);
	const track = defined(defined(allocation.gutterTrackByRelationId[cell.column]).get(relationId));
	return crossingRailX(edge, faceLine(cell.bounds, side), side, track);
}

/** One end of a gutter route: the cell whose gutter it takes and its portal ordinate. */
interface GutterLeg {
	readonly cell: GridCellPlacement;
	readonly y: number;
}

/** The grid-owned points between the portals of a gutter route: rails, then the bus or row run. */
function gutterPoints(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
	[source, target]: readonly [GutterLeg, GutterLeg],
): readonly Point[] {
	const sourceX = railX(routing, allocation, relation.id, source.cell);
	const targetX = railX(routing, allocation, relation.id, target.cell);
	const points: Point[] = [{ x: sourceX, y: source.y }];
	if (sourceX !== targetX) {
		const busY = crossingRunY(routing, allocation, relation);
		points.push({ x: sourceX, y: busY }, { x: targetX, y: busY });
	}
	points.push({ x: targetX, y: target.y });
	return points;
}

export interface GridCrossingRoute {
	readonly route: LayoutRelation;
	readonly portals: readonly [GridCellPortal, GridCellPortal];
}

/**
 * The in-cell pieces of an allocation. They depend on the allocation only through the port points:
 * cells, faces, portal sides and the incident order are fixed for the routing, so the pieces routed
 * for one sequence of port points serve every allocation that repeats it.
 */
function cellPieces(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	ends: readonly { readonly source: CrossingEndpoint; readonly target: CrossingEndpoint }[],
): readonly (readonly Point[])[] {
	const tracks = allocation.portTrackByEndpointId;
	const shared = routing.piecesByPortTracks.get(tracks);
	if (shared !== undefined) return shared;
	const key = ends
		.map(
			({ source, target }) => `${source.port.x},${source.port.y};${target.port.x},${target.port.y}`,
		)
		.join(';');
	const pieces =
		routing.pieceCache.get(key) ??
		routeGridCellIncidents(
			routing.crossing.flatMap((relation, index) => {
				const { source, target } = defined(ends[index]);
				return [source, target].map(({ endpointId, face, port }) => ({
					relationId: relation.id,
					endpointId,
					source: endpointId === relation.from,
					cell: face.cell,
					side: face.side,
					port,
					nested: face.nested,
				}));
			}),
		);
	routing.pieceCache.set(key, pieces);
	routing.piecesByPortTracks.set(tracks, pieces);
	return pieces;
}

/**
 * Every crossing route of one allocation, in `routing.crossing` order: the in-cell pieces from each
 * port to its cell portal, then either the jog through the gap between neighbouring cells, or the
 * column rails at the portal heights and the bus or row gutter.
 */
export function crossingRoutes(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
): readonly GridCrossingRoute[] {
	const ends = routing.crossing.map((relation) => ({
		source: crossingEndpoint(routing, allocation, relation, relation.from),
		target: crossingEndpoint(routing, allocation, relation, relation.to),
	}));
	const pieces = cellPieces(routing, allocation, ends);
	return routing.crossing.map((relation, index) => {
		const { source, target } = defined(ends[index]);
		const sourcePiece = defined(pieces[2 * index]);
		const targetPiece = defined(pieces[2 * index + 1]);
		const portals = {
			source: cellPortal(relation, source, sourcePiece),
			target: cellPortal(relation, target, targetPiece),
		};
		const direct = routing.directByRelationId.get(relation.id);
		let middle: readonly Point[];
		if (direct === undefined)
			middle = gutterPoints(routing, allocation, relation, [
				{ cell: source.face.cell, y: portals.source.point.y },
				{ cell: target.face.cell, y: portals.target.point.y },
			]);
		else
			middle = directJogPoints(
				direct,
				directJog(direct, relation.id, allocation, routing.edges),
				portals.source.point,
				portals.target.point,
			);
		const points: Point[] = [...sourcePiece, ...middle];
		for (let point = targetPiece.length - 1; point >= 0; point -= 1)
			points.push(defined(targetPiece[point]));
		const route = { id: relation.id, from: relation.from, to: relation.to, points };
		return { route, portals: [portals.source, portals.target] as const };
	});
}

/** The canonical portals of each crossing relation: the containment rule reads their points and
 * the port order reads their cells before allocating. */
export function crossingPortalSpans(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
): ReadonlyMap<string, CrossingPortalSpan> {
	const spans = new Map<string, CrossingPortalSpan>();
	const cellById = new Map(routing.cells.map((cell) => [cell.id, cell]));
	const portalOf = ({ endpointId, cellId, point }: GridCellPortal): CrossingPortal => {
		const { row, column } = defined(cellById.get(cellId));
		return { endpointId, row, column, point };
	};
	for (const { route, portals } of crossingRoutes(routing, allocation))
		spans.set(route.id, { source: portalOf(portals[0]), target: portalOf(portals[1]) });
	return spans;
}

/**
 * The owned pieces of a grid region's crossing routes: one per boundary owner, as the composer
 * publishes them, so the contact oracle reads the same pieces as the composition validator. Each
 * cell owns its piece up to its portal; the grid owns the rest between the two portals.
 */
export function gridCrossingOwnedRoutes(
	regionId: string,
	crossing: readonly LogicRelation[],
	routesById: ReadonlyMap<string, LayoutRelation>,
	portals: readonly GridCellPortal[],
): readonly RegionOwnedRoute[] {
	const owned: RegionOwnedRoute[] = [];
	for (const relation of crossing) {
		const { points } = defined(routesById.get(relation.id));
		const portal = (endpointId: string) =>
			defined(
				portals.find(
					(candidate) =>
						candidate.relationId === relation.id && candidate.endpointId === endpointId,
				),
			);
		const source = portal(relation.from);
		const target = portal(relation.to);
		const { sourceEnd, targetStart } = defined(
			incidentPieceEnds(points, source.point, target.point),
		);
		owned.push(
			{
				relationId: relation.id,
				regionId: source.cellId,
				points: points.slice(0, sourceEnd + 1),
			},
			{ relationId: relation.id, regionId, points: points.slice(sourceEnd, targetStart + 1) },
			{ relationId: relation.id, regionId: target.cellId, points: points.slice(targetStart) },
		);
	}
	return owned;
}

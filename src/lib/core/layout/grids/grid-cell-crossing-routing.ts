import { defined, type LogicRelation } from '../../document/logic-document';
import type { Bounds, LayoutRelation, Point } from '../layout-types';
import { type RegionOwnedRoute, RegionPortalSide } from '../regions/model/region-composition-types';
import {
	crossingBusY,
	crossingEndpointSide,
	crossingFaceEdge,
	crossingPortY,
	crossingRailX,
	type GridRoutingEdges,
} from './grid-cell-crossing';
import type {
	CrossingPortal,
	CrossingPortalSpan,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';
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
}

/** What no allocation changes about a crossing endpoint: its cell, face and portal abscissa. */
interface CrossingEndpointFrame {
	readonly cell: GridCellPlacement;
	readonly side: RegionPortalSide.Left | RegionPortalSide.Right;
	/** The endpoint box in grid coordinates. */
	readonly face: Bounds;
	readonly portX: number;
	readonly portalX: number;
	/** Whole-track shift of the endpoint's port stack off its local families. */
	readonly portShift: number;
	readonly nested: boolean;
}

/** The routing input with what no allocation changes, and the pieces routed so far. */
export interface GridCrossingRouting extends GridCrossingRoutingInput {
	readonly frameByEndpointId: ReadonlyMap<string, CrossingEndpointFrame>;
	/** In-cell pieces by the port ordinates of an allocation, filled during the search. */
	readonly pieceCache: Map<string, readonly (readonly Point[])[]>;
	/** The same pieces by port track table: allocations derived from one another share it. */
	readonly piecesByPortTracks: WeakMap<
		GridCrossingAllocation['portTrackByEndpointId'],
		readonly (readonly Point[])[]
	>;
}

/** Compute once, before the allocation search, the routing data every allocation shares. */
export function gridCrossingRouting(input: GridCrossingRoutingInput): GridCrossingRouting {
	const cellById = new Map(input.cells.map((cell) => [cell.id, cell]));
	const fromById = new Map(input.crossing.map(({ id, from }) => [id, from]));
	const frameByEndpointId = new Map<string, CrossingEndpointFrame>();
	for (const [endpointId, relationIds] of input.incidence) {
		const cell = defined(cellById.get(defined(input.cellByEndpointId.get(endpointId))));
		const local = defined(cell.localLayout.elements.find(({ id }) => id === endpointId)).bounds;
		const face = { ...local, x: local.x + cell.translation.x, y: local.y + cell.translation.y };
		const side = crossingEndpointSide(cell.column, input.columnCount);
		let portX = face.x;
		let portalX = cell.bounds.x;
		if (side === RegionPortalSide.Right) {
			portX += face.width;
			portalX += cell.bounds.width;
		}
		const sources = relationIds.map((id) => fromById.get(id) === endpointId);
		frameByEndpointId.set(endpointId, {
			cell,
			side,
			face,
			portX,
			portalX,
			portShift: crossingPortShift(cell, endpointId, side, sources),
			nested: input.nestedEndpointIds.has(endpointId),
		});
	}
	return { ...input, frameByEndpointId, pieceCache: new Map(), piecesByPortTracks: new WeakMap() };
}

/** The port and rail of one crossing endpoint, read from the allocated tracks. */
interface CrossingEndpoint {
	readonly frame: CrossingEndpointFrame;
	readonly endpointId: string;
	readonly port: Point;
	readonly railX: number;
}

function crossingEndpoint(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
	endpointId: string,
): CrossingEndpoint {
	const frame = defined(routing.frameByEndpointId.get(endpointId));
	const { cell, face, side } = frame;
	const incidentCount = defined(routing.incidence.get(endpointId)).length;
	const portTrack = defined(allocation.portTrackByEndpointId.get(endpointId)).get(relation.id);
	const port = {
		x: frame.portX,
		y:
			crossingPortY(face, crossingFaceEdge(endpointId, incidentCount), defined(portTrack)) +
			frame.portShift,
	};
	const edge = defined(routing.edges.gutters[cell.column]);
	const track = defined(defined(allocation.gutterTrackByRelationId[cell.column]).get(relation.id));
	return { frame, endpointId, port, railX: crossingRailX(edge, frame.portalX, side, track) };
}

function cellPortal(
	relation: LogicRelation,
	endpoint: CrossingEndpoint,
	piece: readonly Point[],
): GridCellPortal {
	const { cell, side } = endpoint.frame;
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

export interface GridCrossingRoute {
	readonly route: LayoutRelation;
	readonly portals: readonly [GridCellPortal, GridCellPortal];
}

/**
 * The in-cell pieces of an allocation. They depend on the allocation only through the port
 * ordinates: cells, faces, portal sides and the incident order are fixed for the routing, so the
 * pieces routed for one sequence of port ordinates serve every allocation that repeats it.
 */
function cellPieces(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	ends: readonly { readonly source: CrossingEndpoint; readonly target: CrossingEndpoint }[],
): readonly (readonly Point[])[] {
	const tracks = allocation.portTrackByEndpointId;
	const shared = routing.piecesByPortTracks.get(tracks);
	if (shared !== undefined) return shared;
	const key = ends.map(({ source, target }) => `${source.port.y};${target.port.y}`).join(';');
	const pieces =
		routing.pieceCache.get(key) ??
		routeGridCellIncidents(
			routing.crossing.flatMap((relation, index) => {
				const { source, target } = defined(ends[index]);
				return [source, target].map(({ endpointId, frame, port }) => ({
					relationId: relation.id,
					endpointId,
					source: endpointId === relation.from,
					cell: frame.cell,
					side: frame.side,
					port,
					nested: frame.nested,
				}));
			}),
		);
	routing.pieceCache.set(key, pieces);
	routing.piecesByPortTracks.set(tracks, pieces);
	return pieces;
}

/**
 * Every crossing route of one allocation, in `routing.crossing` order: the in-cell pieces from each
 * port to its cell portal, the column rails at the portal heights and the bus or row gutter.
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
		const sourcePortal = cellPortal(relation, source, sourcePiece);
		const targetPortal = cellPortal(relation, target, targetPiece);
		const points: Point[] = [...sourcePiece, { x: source.railX, y: sourcePortal.point.y }];
		if (source.railX !== target.railX) {
			const busY = crossingRunY(routing, allocation, relation);
			points.push({ x: source.railX, y: busY }, { x: target.railX, y: busY });
		}
		points.push({ x: target.railX, y: targetPortal.point.y });
		for (let point = targetPiece.length - 1; point >= 0; point -= 1)
			points.push(defined(targetPiece[point]));
		const route = { id: relation.id, from: relation.from, to: relation.to, points };
		return { route, portals: [sourcePortal, targetPortal] as const };
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

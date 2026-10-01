import { defined, type LogicRelation } from '../../document/logic-document';
import type { LayoutRelation, Point } from '../layout-types';
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
import {
	type CellObstacles,
	cellObstacles,
	incidentPieceEnds,
	routeGridCellIncidents,
} from './grid-cell-incident-route';
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

/** The routing input with what no allocation changes: port stack shifts and cell obstacles. */
export interface GridCrossingRouting extends GridCrossingRoutingInput {
	readonly portShiftByEndpointId: ReadonlyMap<string, number>;
	readonly obstaclesByCellId: ReadonlyMap<string, CellObstacles>;
}

/** Compute once, before the allocation search, the routing data every allocation shares. */
export function gridCrossingRouting(input: GridCrossingRoutingInput): GridCrossingRouting {
	const cellById = new Map(input.cells.map((cell) => [cell.id, cell]));
	const fromById = new Map(input.crossing.map(({ id, from }) => [id, from]));
	const portShiftByEndpointId = new Map<string, number>();
	const obstaclesByCellId = new Map<string, CellObstacles>();
	for (const [endpointId, relationIds] of input.incidence) {
		const cell = defined(cellById.get(defined(input.cellByEndpointId.get(endpointId))));
		const side = crossingEndpointSide(cell.column, input.columnCount);
		const sources = relationIds.map((id) => fromById.get(id) === endpointId);
		portShiftByEndpointId.set(endpointId, crossingPortShift(cell, endpointId, side, sources));
		if (!obstaclesByCellId.has(cell.id)) obstaclesByCellId.set(cell.id, cellObstacles(cell));
	}
	return { ...input, portShiftByEndpointId, obstaclesByCellId };
}

/** The port, portal side and rail of one crossing endpoint, read from the allocated tracks. */
interface CrossingEndpoint {
	readonly endpointId: string;
	readonly port: Point;
	readonly side: RegionPortalSide.Left | RegionPortalSide.Right;
	readonly railX: number;
	readonly cell: GridCellPlacement;
}

function crossingEndpoint(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
	endpointId: string,
): CrossingEndpoint {
	const { incidence, edges, columnCount, cellByEndpointId } = routing;
	const cellId = defined(cellByEndpointId.get(endpointId));
	const cell = defined(routing.cells.find(({ id }) => id === cellId));
	const local = defined(cell.localLayout.elements.find(({ id }) => id === endpointId));
	const side = crossingEndpointSide(cell.column, columnCount);
	let portX = cell.translation.x + local.bounds.x;
	let portalX = cell.bounds.x;
	if (side === RegionPortalSide.Right) {
		portX += local.bounds.width;
		portalX += cell.bounds.width;
	}
	const incident = defined(incidence.get(endpointId));
	const port = {
		x: portX,
		y:
			crossingPortY(
				{
					...local.bounds,
					x: local.bounds.x + cell.translation.x,
					y: local.bounds.y + cell.translation.y,
				},
				crossingFaceEdge(endpointId, incident.length),
				defined(defined(allocation.portTrackByEndpointId.get(endpointId)).get(relation.id)),
			) + defined(routing.portShiftByEndpointId.get(endpointId)),
	};
	const edge = defined(edges.gutters[cell.column]);
	const track = defined(defined(allocation.gutterTrackByRelationId[cell.column]).get(relation.id));
	return { endpointId, port, side, railX: crossingRailX(edge, portalX, side, track), cell };
}

function cellPortal(
	relation: LogicRelation,
	endpoint: CrossingEndpoint,
	piece: readonly Point[],
): GridCellPortal {
	const { cell } = endpoint;
	const point = defined(piece.at(-1));
	return {
		relationId: relation.id,
		endpointId: endpoint.endpointId,
		cellId: cell.id,
		regionId: cell.id,
		side: endpoint.side,
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
 * Every crossing route of one allocation, in `routing.crossing` order: the in-cell pieces from each
 * port to its cell portal, the column rails at the portal heights and the bus or row gutter.
 */
export function crossingRoutes(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
): readonly GridCrossingRoute[] {
	const ends = routing.crossing.map((relation) => ({
		relation,
		source: crossingEndpoint(routing, allocation, relation, relation.from),
		target: crossingEndpoint(routing, allocation, relation, relation.to),
	}));
	const pieces = routeGridCellIncidents(
		routing.obstaclesByCellId,
		ends.flatMap(({ relation, source, target }) =>
			[source, target].map(({ endpointId, cell, side, port }) => ({
				relationId: relation.id,
				endpointId,
				source: endpointId === relation.from,
				cell,
				side,
				port,
				nested: routing.nestedEndpointIds.has(endpointId),
			})),
		),
	);
	return ends.map(({ relation, source, target }, index) => {
		const sourcePiece = defined(pieces[2 * index]);
		const targetPiece = defined(pieces[2 * index + 1]);
		const portals = [
			cellPortal(relation, source, sourcePiece),
			cellPortal(relation, target, targetPiece),
		] as const;
		const [sourceY, targetY] = portals.map(({ point }) => point.y);
		const points: Point[] = [...sourcePiece, { x: source.railX, y: defined(sourceY) }];
		if (source.railX !== target.railX) {
			const busY = crossingRunY(routing, allocation, relation);
			points.push({ x: source.railX, y: busY }, { x: target.railX, y: busY });
		}
		points.push({ x: target.railX, y: defined(targetY) }, ...[...targetPiece].reverse());
		return { route: { id: relation.id, from: relation.from, to: relation.to, points }, portals };
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

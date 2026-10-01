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
import { crossingRowY } from './grid-cell-crossing-resources';
import type { GridCellInput, GridCellPlacement, GridCellPortal } from './grid-cell-types';

/** The placed cells and the allocated tracks a grid region routes its crossings with. */
export interface GridCrossingRouting {
	readonly rootId: string;
	readonly crossing: readonly LogicRelation[];
	readonly columnCount: number;
	readonly cells: readonly GridCellPlacement[];
	readonly cellByEndpointId: GridCellInput['cellByEndpointId'];
	readonly edges: GridRoutingEdges;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

/** The port, portal and rail of one crossing endpoint, read from the allocated tracks. */
function crossingEndpoint(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
	endpointId: string,
): {
	readonly port: Point;
	readonly portal: GridCellPortal;
	readonly railX: number;
	readonly cell: GridCellPlacement;
} {
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
	const port = {
		x: portX,
		y: crossingPortY(
			{
				...local.bounds,
				x: local.bounds.x + cell.translation.x,
				y: local.bounds.y + cell.translation.y,
			},
			crossingFaceEdge(endpointId, defined(incidence.get(endpointId)).length),
			defined(defined(allocation.portTrackByEndpointId.get(endpointId)).get(relation.id)),
		),
	};
	const global = { x: portalX, y: port.y };
	const portal: GridCellPortal = {
		relationId: relation.id,
		endpointId,
		cellId: cell.id,
		regionId: cell.id,
		side,
		point: global,
		localPoint: { x: global.x - cell.bounds.x, y: global.y - cell.bounds.y },
	};
	const edge = defined(edges.gutters[cell.column]);
	const track = defined(defined(allocation.gutterTrackByRelationId[cell.column]).get(relation.id));
	return { port, portal, railX: crossingRailX(edge, portalX, side, track), cell };
}

export function crossingRoute(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
): { readonly route: LayoutRelation; readonly portals: readonly [GridCellPortal, GridCellPortal] } {
	const source = crossingEndpoint(routing, allocation, relation, relation.from);
	const target = crossingEndpoint(routing, allocation, relation, relation.to);
	const points: Point[] = [source.port, source.portal.point, { x: source.railX, y: source.port.y }];
	if (source.railX === target.railX) {
		points.push({ x: target.railX, y: target.port.y });
	} else {
		const row =
			allocation.rowTrackByRelationId?.findIndex((tracks) => tracks.has(relation.id)) ?? -1;
		const rowTrack = allocation.rowTrackByRelationId?.[row]?.get(relation.id);
		let busY: number;
		if (rowTrack === undefined)
			busY = crossingBusY(
				routing.edges.topBus,
				defined(allocation.busTrackByRelationId.get(relation.id)),
			);
		else {
			const upperCell = defined(routing.cells.find((cell) => cell.row === row));
			busY = crossingRowY(
				defined(routing.edges.rowGutters[row]),
				upperCell.bounds.y + upperCell.bounds.height,
				rowTrack,
			);
		}
		points.push(
			{ x: source.railX, y: busY },
			{ x: target.railX, y: busY },
			{ x: target.railX, y: target.port.y },
		);
	}
	points.push(target.portal.point, target.port);
	return {
		route: { id: relation.id, from: relation.from, to: relation.to, points },
		portals: [source.portal, target.portal],
	};
}

/** The canonical portals of each crossing relation: the containment rule reads their points and
 * the port order reads their cells before allocating. */
export function crossingPortalSpans(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
): ReadonlyMap<string, CrossingPortalSpan> {
	const spans = new Map<string, CrossingPortalSpan>();
	const portalOf = (relation: LogicRelation, endpointId: string): CrossingPortal => {
		const { portal, cell } = crossingEndpoint(routing, allocation, relation, endpointId);
		return { endpointId, row: cell.row, column: cell.column, point: portal.point };
	};
	for (const relation of routing.crossing)
		spans.set(relation.id, {
			source: portalOf(relation, relation.from),
			target: portalOf(relation, relation.to),
		});
	return spans;
}

/**
 * The owned pieces of a grid region's crossing routes: one per boundary owner, as the composer
 * publishes them, so the contact oracle reads the same pieces as the composition validator.
 */
export function gridCrossingOwnedRoutes(
	regionId: string,
	cellByEndpointId: GridCellInput['cellByEndpointId'],
	crossing: readonly LogicRelation[],
	routesById: ReadonlyMap<string, LayoutRelation>,
): readonly RegionOwnedRoute[] {
	const owned: RegionOwnedRoute[] = [];
	for (const relation of crossing) {
		const route = defined(routesById.get(relation.id));
		owned.push(
			{
				relationId: relation.id,
				regionId: defined(cellByEndpointId.get(relation.from)),
				points: route.points.slice(0, 2),
			},
			{ relationId: relation.id, regionId, points: route.points.slice(1, -1) },
			{
				relationId: relation.id,
				regionId: defined(cellByEndpointId.get(relation.to)),
				points: route.points.slice(-2),
			},
		);
	}
	return owned;
}

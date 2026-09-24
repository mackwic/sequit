import { defined, type LogicRelation } from '../document/logic-document';
import {
	crossingBusY,
	crossingPortEdge,
	crossingPortY,
	crossingRailX,
	type GridRoutingEdges,
} from './grid-cell-crossing';
import type { CrossingPortalSpan, GridCrossingAllocation } from './grid-cell-crossing-allocation';
import type { GridCellInput, GridCellPlacement, GridCellPortal } from './grid-cell-types';
import type { LayoutRelation, Point } from './layout-types';
import { type RegionOwnedRoute, RegionPortalSide } from './region-composition-types';

/** The placed cells and the allocated tracks a grid region routes its crossings with. */
export interface GridCrossingRouting {
	readonly rootId: string;
	readonly crossing: readonly LogicRelation[];
	readonly leftRailIds: readonly string[];
	readonly rightRailIds: readonly string[];
	readonly cells: readonly GridCellPlacement[];
	readonly cellByEndpointId: GridCellInput['cellByEndpointId'];
	readonly gridRight: number;
	readonly margin: number;
	readonly edges: GridRoutingEdges;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

/** The port, portal and rail of one crossing endpoint, read from the allocated tracks. */
function crossingEndpoint(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
	endpointId: string,
): { readonly port: Point; readonly portal: GridCellPortal; readonly railX: number } {
	const { rootId, incidence, edges, gridRight, margin, cellByEndpointId } = routing;
	const cellId = defined(cellByEndpointId.get(endpointId));
	const cell = defined(routing.cells.find(({ id }) => id === cellId));
	const local = defined(cell.localLayout.elements.find(({ id }) => id === endpointId));
	let side: RegionPortalSide.Left | RegionPortalSide.Right = RegionPortalSide.Left;
	if (cell.column === 1) side = RegionPortalSide.Right;
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
			crossingPortEdge(rootId, defined(incidence.get(endpointId)).length),
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
	if (side === RegionPortalSide.Right) {
		const track = defined(allocation.rightRailTrackByRelationId.get(relation.id));
		return { port, portal, railX: crossingRailX(edges.leftRail, gridRight, side, track) };
	}
	const track = defined(allocation.leftRailTrackByRelationId.get(relation.id));
	return { port, portal, railX: crossingRailX(edges.leftRail, margin, side, track) };
}

export function crossingRoute(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
	relation: LogicRelation,
): { readonly route: LayoutRelation; readonly portals: readonly [GridCellPortal, GridCellPortal] } {
	const source = crossingEndpoint(routing, allocation, relation, relation.from);
	const target = crossingEndpoint(routing, allocation, relation, relation.to);
	const busY = crossingBusY(
		routing.edges.topBus,
		defined(allocation.busTrackByRelationId.get(relation.id)),
	);
	const points: Point[] = [source.port, source.portal.point, { x: source.railX, y: source.port.y }];
	if (source.railX === target.railX) {
		points.push({ x: target.railX, y: target.port.y });
	} else {
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

/** The canonical portals of each crossing relation: the containment rule reads them before allocating. */
export function crossingPortalSpans(
	routing: GridCrossingRouting,
	allocation: GridCrossingAllocation,
): ReadonlyMap<string, CrossingPortalSpan> {
	const spans = new Map<string, CrossingPortalSpan>();
	for (const relation of routing.crossing) {
		const source = crossingEndpoint(routing, allocation, relation, relation.from);
		const target = crossingEndpoint(routing, allocation, relation, relation.to);
		spans.set(relation.id, { source: source.portal.point, target: target.portal.point });
	}
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

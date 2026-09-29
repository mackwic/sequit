import { defined } from '../../document/logic-document';
import type { LayoutFrame } from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds, RoutingLayers } from '../layout-types';
import { routePoints } from './endpoint-routes';
import { freeOfGroupShells, type MainInterval } from './group-shells';
import { prepareRouteObstacles, routeHitsObstacles, type RouteObstacles } from './route-obstacles';
import { layerExtent } from './routing-layers';

export interface RoutingSpace {
	readonly layers: RoutingLayers;
	readonly enclosingGroups: ReadonlySet<string>;
	readonly extents: readonly MainInterval[];
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly frame: LayoutFrame;
}

export interface DirectRoutingSpace extends RoutingSpace {
	readonly obstacles: ReadonlyMap<number, RouteObstacles>;
}

interface RoutingSpaceInput {
	readonly layers: RoutingLayers;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly frame: LayoutFrame;
	readonly enclosingGroups: ReadonlySet<string>;
}

/**
 * Rails between two layers leave both layers' boxes and the shells of group frames beginning or
 * ending between them: each layer extent reaches to the free part of its bordering gaps.
 */
function clearOfFrames(
	extents: readonly MainInterval[],
	frames: readonly MainInterval[],
): readonly MainInterval[] {
	if (frames.length === 0) return extents;
	const layers = extents.flatMap((extent, index) => {
		if (Number.isFinite(extent.start) && Number.isFinite(extent.end)) return [index];
		return [];
	});
	const gaps = layers.slice(1).map((layer, index) => ({
		start: defined(extents[defined(layers[index])]).end,
		end: defined(extents[layer]).start,
	}));
	const free = freeOfGroupShells(gaps, frames);
	const result = extents.map(({ start, end }): { start: number; end: number } => ({ start, end }));
	for (const [index, gap] of free.entries()) {
		defined(result[defined(layers[index])]).end = gap.start;
		defined(result[defined(layers[index + 1])]).start = gap.end;
	}
	return result;
}

/** A common rail stays outside every atomic box and group shell bordering its gap. */
export function routingSpace(input: RoutingSpaceInput): RoutingSpace {
	const { layers, bounds, frame, enclosingGroups } = input;
	// A populated group is an envelope spanning its members, not a box on one physical layer.
	const boxes = layers.rows.map((row) =>
		layerExtent(
			row.filter((id) => !enclosingGroups.has(id)),
			bounds,
			frame,
		),
	);
	const frames = [...enclosingGroups]
		.filter((id) => bounds.has(id))
		.map((id) => layerExtent([id], bounds, frame));
	const extents = clearOfFrames(boxes, frames);
	return { layers, enclosingGroups, extents, bounds, frame };
}

/** Intermediate-layer obstacle indexes are needed only when choosing direct passages. */
export function directRoutingSpace(
	input: RoutingSpaceInput & { readonly junctionIds: ReadonlySet<string> },
): DirectRoutingSpace {
	const space = routingSpace(input);
	const obstacles = new Map<number, RouteObstacles>();
	for (const [index, row] of space.layers.rows.entries()) {
		if (!row.some((id) => input.junctionIds.has(id))) continue;
		obstacles.set(
			index,
			prepareRouteObstacles(
				row.map((id) => defined(space.bounds.get(id))),
				RAIL_SPACING,
			),
		);
	}
	return { ...space, obstacles };
}

/** Preferred transverse rail; intermediate layers still need the obstacle check below. */
export function directRouteRail(space: RoutingSpace, from: string, to: string): number | undefined {
	if (space.enclosingGroups.has(from) || space.enclosingGroups.has(to)) return undefined;
	const source = defined(space.layers.byId.get(from));
	const target = defined(space.layers.byId.get(to));
	if (source <= target) return undefined;
	const before = defined(space.extents[target]);
	const after = defined(space.extents[source]);
	if (!Number.isFinite(before.end) || !Number.isFinite(after.start)) return undefined;
	if (before.end > after.start) return undefined;
	let middle = (before.end + after.start) / 2;
	if (!space.frame.forward) middle = -middle;
	return middle;
}

/** Sharing a junction's layer is allowed only on a portion outside its obstacles. */
export function directRouteFitsSpace(space: DirectRoutingSpace, from: string, to: string): boolean {
	const rail = directRouteRail(space, from, to);
	if (rail === undefined) return false;
	const points = routePoints({
		source: defined(space.bounds.get(from)),
		target: defined(space.bounds.get(to)),
		direction: space.frame.direction,
		rail,
	});
	const source = defined(space.layers.byId.get(from));
	const target = defined(space.layers.byId.get(to));
	for (let layer = target + 1; layer < source; layer += 1) {
		const obstacles = space.obstacles.get(layer);
		if (obstacles === undefined || routeHitsObstacles(points, obstacles)) return false;
	}
	return true;
}

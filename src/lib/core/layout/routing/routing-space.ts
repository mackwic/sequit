import { defined } from '../../document/logic-document';
import { type LayoutFrame, transverseSize, transverseStart } from '../geometry/layout-frame';
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

interface ComponentInterval {
	start: number;
	end: number;
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
export function routingSpace(input: RoutingSpaceInput, transverse?: MainInterval): RoutingSpace {
	const { layers, bounds, frame, enclosingGroups } = input;
	const overlaps = (id: string): boolean => {
		if (transverse === undefined) return true;
		const box = defined(bounds.get(id));
		const start = transverseStart(box, frame.vertical);
		const end = start + transverseSize(box, frame.vertical);
		return start <= transverse.end && end >= transverse.start;
	};
	// Empty local rows are only waypoints of straight passages through another component's layer.
	const boxes = layers.rows.map((row) => {
		const atomic = row.filter((id) => !enclosingGroups.has(id));
		if (transverse === undefined) return layerExtent(atomic, bounds, frame);
		const local = atomic.filter(overlaps);
		if (local.length === 0) return layerExtent(atomic, bounds, frame);
		return layerExtent(local, bounds, frame);
	});
	const frames = [...enclosingGroups]
		.filter((id) => bounds.has(id) && overlaps(id))
		.map((id) => layerExtent([id], bounds, frame));
	// A row holding only frames, such as a relation endpoint framing its empty subgroups, has no
	// atomic box: its rails leave from those frames' faces rather than from an infinite extent.
	const extents = clearOfFrames(boxes, frames).map((extent, index) => {
		if (Number.isFinite(extent.start)) return extent;
		return layerExtent(defined(layers.rows[index]), bounds, frame);
	});
	return { layers, enclosingGroups, extents, bounds, frame };
}

/** Each connected component shares a rail window, without borrowing a distant frame's shell. */
export function componentRoutingSpaces(
	input: RoutingSpaceInput,
	owners: ReadonlyMap<string, number>,
): ReadonlyMap<number, RoutingSpace> {
	const intervals = new Map<number, ComponentInterval>();
	for (const [id, box] of input.bounds) {
		const owner = owners.get(id);
		if (owner === undefined) continue;
		const start = transverseStart(box, input.frame.vertical);
		const end = start + transverseSize(box, input.frame.vertical);
		const interval = intervals.get(owner);
		if (interval === undefined) intervals.set(owner, { start, end });
		else {
			interval.start = Math.min(interval.start, start);
			interval.end = Math.max(interval.end, end);
		}
	}
	// Components whose transverse corridors overlap must still use the same physical rail window.
	let shared: ComponentInterval | undefined;
	for (const [owner, interval] of [...intervals].sort(
		(left, right) => left[1].start - right[1].start,
	)) {
		if (shared === undefined || interval.start > shared.end) shared = interval;
		else shared.end = Math.max(shared.end, interval.end);
		intervals.set(owner, shared);
	}
	const spaces = new Map<number, RoutingSpace>();
	const byInterval = new Map<MainInterval, RoutingSpace>();
	for (const [owner, interval] of intervals) {
		let space = byInterval.get(interval);
		if (space === undefined) {
			space = routingSpace(input, interval);
			byInterval.set(interval, space);
		}
		spaces.set(owner, space);
	}
	return spaces;
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

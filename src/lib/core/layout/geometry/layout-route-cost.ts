import type { LayoutRelation, LayoutResult } from '../layout-types';

/** The declared cost of one materialized layout: its frame area, route length and bends. */
export interface RouteCost {
	readonly area: number;
	readonly routeLength: number;
	readonly bends: number;
}

function routeLengthAndBends(route: LayoutRelation): { routeLength: number; bends: number } {
	let routeLength = 0;
	let bends = 0;
	let previousHorizontal: boolean | undefined;
	for (let index = 1; index < route.points.length; index += 1) {
		const before = route.points[index - 1];
		const after = route.points[index];
		if (before === undefined || after === undefined) continue;
		const dx = Math.abs(after.x - before.x);
		const dy = Math.abs(after.y - before.y);
		routeLength += dx + dy;
		if (dx === 0 && dy === 0) continue;
		const horizontal = dx > 0;
		if (previousHorizontal !== undefined && previousHorizontal !== horizontal) bends += 1;
		previousHorizontal = horizontal;
	}
	return { routeLength, bends };
}

/**
 * The two costs the detour/bridge policy compares, plus the bends the visual panels report: the
 * frame area and the summed Manhattan length of every route.
 */
export function layoutRouteCost(layout: LayoutResult): RouteCost {
	let routeLength = 0;
	let bends = 0;
	for (const route of layout.relations) {
		const cost = routeLengthAndBends(route);
		routeLength += cost.routeLength;
		bends += cost.bends;
	}
	return { area: layout.width * layout.height, routeLength, bends };
}

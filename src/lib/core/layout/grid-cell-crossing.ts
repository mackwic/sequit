import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicRelation } from '../document/logic-document';
import {
	MetricAxis,
	MetricDemandKind,
	type MinimumEndpointExtentMetricDemand,
} from './contract/metric-demand';
import { equal } from './grid-cell-geometry-primitives';
import type { Bounds, LayoutRelation, Point } from './layout-types';

const PORT_INSET = 16;
export const CROSSING_SPACING = 24;
const GRID_MARGIN = 96;

export function crossingIncidence(
	crossing: readonly LogicRelation[],
): ReadonlyMap<string, readonly string[]> {
	const byEndpoint = new Map<string, string[]>();
	for (const relation of crossing) {
		for (const id of [relation.from, relation.to]) {
			const incident = byEndpoint.get(id) ?? [];
			incident.push(relation.id);
			byEndpoint.set(id, incident);
		}
	}
	for (const incident of byEndpoint.values()) incident.sort(compareCanonicalStrings);
	return byEndpoint;
}

export function crossingMetricDemands(
	incidence: ReadonlyMap<string, readonly string[]>,
): readonly MinimumEndpointExtentMetricDemand[] {
	return [...incidence]
		.sort(([left], [right]) => compareCanonicalStrings(left, right))
		.map(([endpointId, relations]) => {
			const span = CROSSING_SPACING * (relations.length - 1);
			return {
				kind: MetricDemandKind.MinimumEndpointExtent,
				endpointId,
				axis: MetricAxis.Height,
				minimum: PORT_INSET * 2 + span,
			};
		});
}

export function crossingPortY(
	bounds: Bounds,
	endpointId: string,
	relationId: string,
	incidence: ReadonlyMap<string, readonly string[]>,
): number {
	const relations = defined(incidence.get(endpointId));
	const index = relations.indexOf(relationId);
	const center = bounds.y + bounds.height / 2;
	const middleIndex = (relations.length - 1) / 2;
	const displacement = (index - middleIndex) * CROSSING_SPACING;
	return center + displacement;
}

export function crossingMargin(count: number): number {
	return GRID_MARGIN + CROSSING_SPACING * Math.max(0, count - 1);
}

function segmentOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
	if (equal(a.x, b.x) && equal(c.x, d.x) && equal(a.x, c.x)) {
		const high = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
		const low = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
		return high > low + 1e-6;
	}
	if (equal(a.y, b.y) && equal(c.y, d.y) && equal(a.y, c.y)) {
		const high = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
		const low = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
		return high > low + 1e-6;
	}
	return false;
}

function routesOverlap(first: LayoutRelation, second: LayoutRelation): boolean {
	for (let i = 0; i < first.points.length - 1; i += 1) {
		for (let j = 0; j < second.points.length - 1; j += 1) {
			if (
				segmentOverlap(
					defined(first.points[i]),
					defined(first.points[i + 1]),
					defined(second.points[j]),
					defined(second.points[j + 1]),
				)
			)
				return true;
		}
	}
	return false;
}

export function crossingOverlap(routes: readonly LayoutRelation[]): string | undefined {
	for (const [index, first] of routes.entries()) {
		for (const second of routes.slice(index + 1)) {
			if (routesOverlap(first, second))
				return `Cross-cell relations ${first.id} and ${second.id} overlap.`;
		}
	}
	return undefined;
}

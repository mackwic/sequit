import {
	defined,
	EndpointKind,
	LayoutDirection,
} from '../../../src/lib/core/document/logic-document';
import type { Bounds, Point } from '../../../src/lib/core/layout/layout-types';
import type { VisualLayout } from '../harnesses/visual-layout';
import { routeCrossings } from './route-geometry';
import { routeNetworks } from './route-networks';

/**
 * What a layout decides without coordinates: the order of the boxes of each rank, the port groups
 * of each face in order, the pairs of routes that cross and the routes joined by shared ink.
 */
export interface LayoutTopology {
	readonly rows: readonly (readonly string[])[];
	readonly faces: Readonly<Record<string, readonly (readonly string[])[]>>;
	readonly crossings: readonly string[];
	readonly networks: readonly (readonly string[])[];
}

function vertical(direction: LayoutDirection): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
}

function side(point: Point, bounds: Bounds): string {
	if (point.y === bounds.y) return 'top';
	if (point.y === bounds.y + bounds.height) return 'bottom';
	if (point.x === bounds.x) return 'left';
	if (point.x === bounds.x + bounds.width) return 'right';
	return 'inside';
}

/** The center of a box across the layout flow. */
function across(bounds: Bounds, direction: LayoutDirection): number {
	if (vertical(direction)) return bounds.x + bounds.width / 2;
	return bounds.y + bounds.height / 2;
}

function rows(layout: VisualLayout): string[][] {
	const byRank = new Map<number, { id: string; center: number }[]>();
	for (const element of layout.elements) {
		if (element.kind !== EndpointKind.Node) continue;
		const { rank } = layout.getNodeById(element.id);
		const center = across(element.bounds, layout.direction);
		byRank.set(rank, [...(byRank.get(rank) ?? []), { id: element.id, center }]);
	}
	return [...byRank.entries()]
		.toSorted(([a], [b]) => a - b)
		.map(([, row]) => row.toSorted((a, b) => a.center - b.center).map(({ id }) => id));
}

/** The position of a port along its face. */
function along(point: Point, face: string): number {
	if (face === 'top' || face === 'bottom') return point.x;
	return point.y;
}

function faces(layout: VisualLayout): Record<string, string[][]> {
	const uses = new Map<string, { id: string; along: number }[]>();
	for (const relation of layout.relations) {
		const ends = [
			[relation.from, defined(relation.points[0])],
			[relation.to, defined(relation.points.at(-1))],
		] as const;
		for (const [endpoint, point] of ends) {
			const { bounds } = layout.getById(endpoint);
			const face = side(point, bounds);
			const key = `${endpoint}:${face}`;
			uses.set(key, [...(uses.get(key) ?? []), { id: relation.id, along: along(point, face) }]);
		}
	}
	const result: Record<string, string[][]> = {};
	for (const key of [...uses.keys()].toSorted()) {
		const groups = new Map<number, string[]>();
		for (const { id, along } of defined(uses.get(key)))
			groups.set(along, [...(groups.get(along) ?? []), id]);
		result[key] = [...groups.entries()]
			.toSorted(([a], [b]) => a - b)
			.map(([, ids]) => ids.toSorted());
	}
	return result;
}

export function layoutTopology(layout: VisualLayout): LayoutTopology {
	return {
		rows: rows(layout),
		faces: faces(layout),
		crossings: routeCrossings(layout.relations)
			.map(({ horizontalId, verticalId }) => [horizontalId, verticalId].toSorted().join(' × '))
			.toSorted(),
		networks: routeNetworks(layout.relations)
			.filter((network) => network.length > 1)
			.map((network) => network.map(({ id }) => id).toSorted())
			.toSorted((a, b) => a.join().localeCompare(b.join())),
	};
}

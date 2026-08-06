import type { LayoutDirection } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { isVerticalDirection } from './component-layout';
import type { Bounds } from './layout-types';

function directRegularBounds(
	graph: LogicGraph,
	boundsById: ReadonlyMap<string, Bounds>,
	ids: readonly string[],
): readonly Bounds[] | undefined {
	const result: Bounds[] = [];
	for (const id of ids) {
		if (graph.endpointsById.get(id)?.kind === 'junction') return undefined;
		const bounds = boundsById.get(id);
		if (!bounds) return undefined;
		result.push(bounds);
	}
	if (result.length === 0) return undefined;
	return result;
}

function primaryRelationBoundary(
	bounds: Bounds,
	direction: LayoutDirection,
	source: boolean,
): number {
	switch (direction) {
		case 'top-to-bottom':
			if (source) return bounds.y + bounds.height;
			return bounds.y;
		case 'bottom-to-top':
			if (source) return bounds.y;
			return bounds.y + bounds.height;
		case 'left-to-right':
			if (source) return bounds.x + bounds.width;
			return bounds.x;
		case 'right-to-left':
			if (source) return bounds.x;
			return bounds.x + bounds.width;
		default:
			throw new Error(`Unsupported layout direction: ${String(direction)}`);
	}
}

function groupRelatedEndpointIds(graph: LogicGraph): ReadonlySet<string> {
	const groupIds = new Set(graph.document.groups.map(({ id }) => id));
	const result = new Set<string>();
	if (groupIds.size === 0) return result;
	for (const { from, to } of graph.document.relations) {
		if (groupIds.has(from)) result.add(to);
		if (groupIds.has(to)) result.add(from);
	}
	return result;
}

export function centerDirectJunctions(
	graph: LogicGraph,
	boundsById: Map<string, Bounds>,
	direction: LayoutDirection,
): void {
	const groupRelatedIds = groupRelatedEndpointIds(graph);
	for (const { id } of graph.document.junctions) {
		if (groupRelatedIds.has(id)) continue;
		const junctionBounds = boundsById.get(id);
		if (!junctionBounds) continue;
		const sources = directRegularBounds(
			graph,
			boundsById,
			graph.predecessorsByEndpointId.get(id) ?? [],
		);
		const targets = directRegularBounds(
			graph,
			boundsById,
			graph.outgoingByEndpointId.get(id) ?? [],
		);
		if (!sources || !targets) continue;
		const forward = direction === 'top-to-bottom' || direction === 'left-to-right';
		const sourceCoordinates = sources.map((bounds) =>
			primaryRelationBoundary(bounds, direction, true),
		);
		const targetCoordinates = targets.map((bounds) =>
			primaryRelationBoundary(bounds, direction, false),
		);
		let sourceBoundary = Math.min(...sourceCoordinates);
		let targetBoundary = Math.max(...targetCoordinates);
		if (forward) {
			sourceBoundary = Math.max(...sourceCoordinates);
			targetBoundary = Math.min(...targetCoordinates);
		}
		const center = (sourceBoundary + targetBoundary) / 2;
		if (isVerticalDirection(direction)) {
			boundsById.set(id, { ...junctionBounds, y: center - junctionBounds.height / 2 });
		} else {
			boundsById.set(id, { ...junctionBounds, x: center - junctionBounds.width / 2 });
		}
	}
}

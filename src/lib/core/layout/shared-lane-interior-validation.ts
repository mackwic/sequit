import type { LogicGraph } from '../graph/create-graph';
import { SHARED_LANE_CLEARANCE } from './shared-lane-frame';
import { validateSharedLaneGeometry } from './shared-lane-geometry';
import type { SharedLaneGeometry } from './shared-lane-types';

/** Check a selected passage from geometry alone, independently of its planned track. */
export function validateSharedLaneInteriorPassage(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
	relationId: string,
): string | undefined {
	// This also checks orthogonal continuity, attachment, canvas and lane confinement,
	// and twelve pixels of clearance from every foreign element.
	const geometric = validateSharedLaneGeometry(graph, geometry, SHARED_LANE_CLEARANCE);
	if (geometric !== undefined) return geometric;
	const middle = geometry.lanes[1];
	const route = geometry.relations.find(({ id }) => id === relationId);
	if (middle === undefined || route === undefined)
		return `Relation ${relationId} has no middle-lane passage.`;
	const first = route.points[0];
	const last = route.points.at(-1);
	if (first === undefined || last === undefined)
		return `Relation ${relationId} has no continuous route.`;
	const descending = first.y > last.y;
	for (let index = 1; index < route.points.length; index += 1) {
		const before = route.points[index - 1];
		const after = route.points[index];
		if (before === undefined || after === undefined)
			return `Relation ${relationId} has no continuous route.`;
		if (descending && after.y > before.y)
			return `Relation ${relationId} does not progress monotonically.`;
		if (!descending && after.y < before.y)
			return `Relation ${relationId} does not progress monotonically.`;
	}
	const left = middle.bounds.x;
	const right = left + middle.bounds.width;
	const crossing = route.points.some((point, index) => {
		const next = route.points[index + 1];
		if (next?.y !== point.y) return false;
		const spans = Math.min(point.x, next.x) < left && Math.max(point.x, next.x) > right;
		const betweenPorts = point.y > Math.min(first.y, last.y) && point.y < Math.max(first.y, last.y);
		return spans && betweenPorts;
	});
	if (!crossing) return `Relation ${relationId} has no monotone interior middle-lane passage.`;
	return undefined;
}

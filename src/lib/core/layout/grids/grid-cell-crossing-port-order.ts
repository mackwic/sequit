import { defined } from '../../document/logic-document';
import type {
	CrossingAllocationInput,
	CrossingPortal,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';

/** Where a crossing route runs along its rail after leaving one face. */
enum RailRun {
	Up = 0,
	Down = 1,
}

/**
 * The run from `near`: a row-routed relation runs to its row boundary, below the upper row; a
 * relation between columns climbs to the top bus; a relation within one column runs along the
 * shared rail towards its other endpoint, in another row.
 */
function railRun(
	allocation: GridCrossingAllocation,
	relationId: string,
	near: CrossingPortal,
	far: CrossingPortal,
): RailRun {
	let boundary = (allocation.rowTrackByRelationId ?? []).findIndex((tracks) =>
		tracks.has(relationId),
	);
	if (boundary < 0 && near.column === far.column) boundary = far.row;
	if (boundary < 0 || near.row > boundary) return RailRun.Up;
	return RailRun.Down;
}

interface FacePort {
	readonly relationId: string;
	readonly run: RailRun;
	/** Rail track, signed so that a smaller value takes a higher port within its run. */
	readonly track: number;
}

function facePort(
	input: CrossingAllocationInput,
	allocation: GridCrossingAllocation,
	endpointId: string,
	relationId: string,
): FacePort {
	const span = defined(input.portalByRelationId.get(relationId));
	let near = span.source;
	let far = span.target;
	if (near.endpointId !== endpointId) [near, far] = [far, near];
	const run = railRun(allocation, relationId, near, far);
	const rail = defined(allocation.gutterTrackByRelationId[near.column]);
	let track = defined(rail.get(relationId));
	if (run === RailRun.Down) track = -track;
	return { relationId, run, track };
}

/**
 * Port order on each face read from the allocated runs. A horizontal leg crosses every inner
 * rail whose run passes its port, so a route running up from an inner track takes a higher port
 * than any outer one, a route running down a lower one: the upward runs sit above the downward
 * ones, nested around the face. The ports of one face leave by distinct tracks of one gutter, so
 * the order is total. With `active`, only those relations are reordered, on the ports they
 * already hold.
 */
export function routedPortAllocation(
	input: CrossingAllocationInput,
	allocation: GridCrossingAllocation,
	active?: ReadonlySet<string>,
): GridCrossingAllocation {
	const portTrackByEndpointId = new Map<string, ReadonlyMap<string, number>>();
	for (const [endpointId, relationIds] of input.incidence) {
		const declared = defined(allocation.portTrackByEndpointId.get(endpointId));
		const movable = relationIds.filter((id) => active?.has(id) ?? true);
		const slots = movable.map((id) => defined(declared.get(id))).sort((a, b) => a - b);
		const ports = movable
			.map((relationId) => facePort(input, allocation, endpointId, relationId))
			.sort((left, right) => left.run - right.run || left.track - right.track);
		const tracks = new Map(declared);
		for (const [index, { relationId }] of ports.entries())
			tracks.set(relationId, defined(slots[index]));
		portTrackByEndpointId.set(endpointId, tracks);
	}
	return { ...allocation, portTrackByEndpointId };
}

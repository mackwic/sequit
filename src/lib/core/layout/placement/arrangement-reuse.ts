import { defined } from '../../document/logic-document';
import {
	type MutableBounds,
	translateTransversely,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import type { PlacementRows } from '../structure/placement-rows';
import type { BranchAlignment } from './align-families';
import type { FrameReserve } from './group-enclosure';

/** Transverse inputs and outcome of one arrangement of some rows. */
interface Arranged {
	readonly sizes: ReadonlyMap<string, number>;
	readonly offsets: ReadonlyMap<string, number> | undefined;
	readonly starts: ReadonlyMap<string, number>;
	/** Frames of the blocks seated without members, as arranged. */
	readonly seats: ReadonlyMap<string, MutableBounds>;
}

/** Arrangements of some rows by the frame room their blocks reserve. */
const arranged = new WeakMap<PlacementRows, Map<string, Arranged>>();

function sameEntries(
	left: ReadonlyMap<string, number> | undefined,
	right: ReadonlyMap<string, number> | undefined,
): boolean {
	if (left === undefined || right === undefined) return left === right;
	if (left.size !== right.size) return false;
	for (const [id, value] of left) if (right.get(id) !== value) return false;
	return true;
}

export interface ReusableArrangement {
	readonly rows: PlacementRows;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
	readonly alignment?: BranchAlignment | undefined;
	readonly reserves?: ReadonlyMap<string, FrameReserve> | undefined;
}

/**
 * A block arrangement only depends on its rows, the transverse sizes of their endpoints, the
 * branch offsets and the room its blocks reserve: a later placement pass with the same inputs
 * takes the same transverse starts and seats back, then rebuilds the frames, instead of
 * arranging again.
 */
export function arrangeOnce(
	input: ReusableArrangement,
	steps: {
		readonly arrange: () => void;
		readonly rebuildFrames: () => void;
		/** Blocks without members, whose seat frames rebuilding keeps. */
		readonly seats: readonly string[];
	},
): void {
	const { rows, bounds, vertical } = input;
	const ids = rows.ordinary.flat();
	const sizes = new Map(ids.map((id) => [id, transverseSize(defined(bounds.get(id)), vertical)]));
	const offsets = input.alignment?.offsets;
	const byReserves = arranged.get(rows) ?? new Map<string, Arranged>();
	arranged.set(rows, byReserves);
	const reserves = JSON.stringify([...(input.reserves ?? [])]);
	const previous = byReserves.get(reserves);
	if (
		previous !== undefined &&
		sameEntries(previous.sizes, sizes) &&
		sameEntries(previous.offsets, offsets)
	) {
		for (const [id, start] of previous.starts) {
			const box = defined(bounds.get(id));
			translateTransversely(box, start - transverseStart(box, vertical), vertical);
		}
		for (const [id, seat] of previous.seats) bounds.set(id, { ...seat });
		steps.rebuildFrames();
		return;
	}
	steps.arrange();
	const starts = new Map(ids.map((id) => [id, transverseStart(defined(bounds.get(id)), vertical)]));
	const seats = new Map<string, MutableBounds>();
	for (const id of steps.seats) {
		const seat = bounds.get(id);
		if (seat !== undefined) seats.set(id, { ...seat });
	}
	let copied: ReadonlyMap<string, number> | undefined;
	if (offsets !== undefined) copied = new Map(offsets);
	byReserves.set(reserves, { sizes, offsets: copied, starts, seats });
}

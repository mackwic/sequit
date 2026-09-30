import { defined } from '../../document/logic-document';
import {
	type MutableBounds,
	translateTransversely,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import type { PlacementRows } from '../structure/placement-rows';
import type { BranchAlignment } from './align-families';

/** Transverse inputs and outcome of one arrangement of some rows. */
interface Arranged {
	readonly sizes: ReadonlyMap<string, number>;
	readonly offsets: ReadonlyMap<string, number> | undefined;
	readonly starts: ReadonlyMap<string, number>;
}

const arranged = new WeakMap<PlacementRows, Arranged>();

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
}

/**
 * A block arrangement only depends on its rows, the transverse sizes of their endpoints and the
 * branch offsets: a later placement pass with the same inputs takes the same transverse starts
 * back, then rebuilds the frames, instead of arranging again.
 */
export function arrangeOnce(
	input: ReusableArrangement,
	steps: { readonly arrange: () => void; readonly rebuildFrames: () => void },
): void {
	const { rows, bounds, vertical } = input;
	const ids = rows.ordinary.flat();
	const sizes = new Map(ids.map((id) => [id, transverseSize(defined(bounds.get(id)), vertical)]));
	const offsets = input.alignment?.offsets;
	const previous = arranged.get(rows);
	if (
		previous !== undefined &&
		sameEntries(previous.sizes, sizes) &&
		sameEntries(previous.offsets, offsets)
	) {
		for (const [id, start] of previous.starts) {
			const box = defined(bounds.get(id));
			translateTransversely(box, start - transverseStart(box, vertical), vertical);
		}
		steps.rebuildFrames();
		return;
	}
	steps.arrange();
	const starts = new Map(ids.map((id) => [id, transverseStart(defined(bounds.get(id)), vertical)]));
	let copied: ReadonlyMap<string, number> | undefined;
	if (offsets !== undefined) copied = new Map(offsets);
	arranged.set(rows, { sizes, offsets: copied, starts });
}

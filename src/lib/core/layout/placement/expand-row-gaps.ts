import { defined } from '../../document/logic-document';
import {
	type LayoutFrame,
	type MutableBounds,
	pointOnAxes,
	translateBounds,
} from '../geometry/layout-frame';
import { BASE_RANK_GAP } from '../layout-settings';

/** For ordinary nodes only, reserved rails change main positions without changing transverse placement. */
export function expandRowGaps(input: {
	readonly bounds: ReadonlyMap<string, MutableBounds>;
	readonly ranks: ReadonlyMap<string, number>;
	readonly gaps: ReadonlyMap<number, number>;
	readonly maximumRank: number;
	readonly frame: LayoutFrame;
}): void {
	const shifts = [0];
	for (let rank = 0; rank < input.maximumRank; rank += 1)
		shifts.push(defined(shifts[rank]) + (input.gaps.get(rank) ?? BASE_RANK_GAP) - BASE_RANK_GAP);
	const total = defined(shifts[input.maximumRank]);
	for (const [id, box] of input.bounds) {
		let offset = defined(shifts[defined(input.ranks.get(id))]);
		if (!input.frame.forward) offset = total - offset;
		const translation = pointOnAxes(0, offset, input.frame.vertical);
		translateBounds(box, translation.x, translation.y);
	}
}

import { defined } from '../../document/logic-document';
import { type Interval, transverseEnvelope } from '../geometry/envelope';
import type { MutableBounds } from '../geometry/layout-frame';
import { ITEM_GAP } from '../layout-settings';
import type { RowAnchorItem } from './fit-row-anchors';

interface ReachContext {
	readonly bounds: { get(id: string): MutableBounds | undefined };
	readonly vertical: boolean;
	readonly gapBetween?: ((left: string, right: string) => number) | undefined;
}

interface Reached {
	readonly ids: readonly string[];
	readonly envelope: Interval;
}

/** The related endpoint standing first, or last, along the row. */
function edge(ids: readonly string[], context: ReachContext, last: boolean): string {
	const { bounds, vertical } = context;
	const extents = ids.map((id) => ({ id, ...transverseEnvelope([id], bounds, vertical) }));
	let best = defined(extents[0]);
	for (const extent of extents) {
		if (last && extent.end > best.end) best = extent;
		if (!last && extent.start < best.start) best = extent;
	}
	return best.id;
}

/**
 * Parents facing disjoint families keep room for both once centered on them: the children of
 * two parents must fit side by side, their row's gap apart. A family blocked by a wider
 * neighbor then makes its parents spread instead of staying off center below them.
 */
export function withReaches(
	items: readonly RowAnchorItem[],
	related: readonly (readonly string[])[],
	context: ReachContext,
): readonly RowAnchorItem[] {
	let previous: Reached | undefined;
	return items.map((item, index) => {
		const ids = defined(related[index]);
		// Only a family facing related endpoints has a target.
		if (item.fixed || item.target === undefined) return item;
		const envelope = transverseEnvelope(ids, context.bounds, context.vertical);
		let gap: number | undefined;
		if (previous !== undefined && previous.envelope.end <= envelope.start) {
			const left = edge(previous.ids, context, true);
			gap = context.gapBetween?.(left, edge(ids, context, false)) ?? ITEM_GAP;
		}
		previous = { ids, envelope };
		const { target } = item;
		return { ...item, reach: { start: envelope.start - target, end: envelope.end - target, gap } };
	});
}

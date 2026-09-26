import { defined } from '../../document/logic-document';
import type { Bounds, LayoutResult, Point } from '../layout-types';
import { finiteBounds, sameBounds, within } from './grid-cell-geometry-primitives';

interface GridLaneCandidate {
	readonly cells: readonly {
		readonly id: string;
		readonly bounds: Bounds;
		readonly translation: Point;
		readonly localLayout: LayoutResult;
	}[];
	readonly layout: LayoutResult;
}

/** Check each published lane against its independent cell and translated geometry. */
export function validateGridCellLaneGeometry(candidate: GridLaneCandidate): string | undefined {
	const expected = candidate.cells.flatMap((cell) =>
		(cell.localLayout.lanes ?? []).map((lane) => ({ cell, lane })),
	);
	const published = candidate.layout.lanes ?? [];
	if (published.length !== expected.length)
		return 'The composed grid does not publish each local lane exactly once.';
	for (const [index, { cell, lane }] of expected.entries()) {
		const global = defined(published[index]);
		if (lane.regionId !== cell.id || global.regionId !== cell.id)
			return `Lane ${lane.id} has the wrong cell owner.`;
		if (global.id !== lane.id || global.label !== lane.label)
			return `Lane ${lane.id} differs from its cell layout.`;
		const translated = {
			...lane.bounds,
			x: lane.bounds.x + cell.translation.x,
			y: lane.bounds.y + cell.translation.y,
		};
		if (!finiteBounds(global.bounds) || !sameBounds(global.bounds, translated))
			return `Lane ${lane.id} differs from its cell layout.`;
		if (!within(cell.bounds, global.bounds)) return `Lane ${lane.id} escapes cell ${cell.id}.`;
	}
	return undefined;
}

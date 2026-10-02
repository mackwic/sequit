import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grids/grid-cell-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedCellGrid } from './grid-cell-fixture';

const FLOWS = [
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
] as const;

function busWitness(
	columns: number,
	cells: readonly (readonly string[])[],
	pairs: readonly (readonly [string, string])[],
	flow: (typeof FLOWS)[number],
) {
	const document = persistedCellGrid(columns, cells, pairs, flow);
	const input = {
		rootId: '@root',
		cells: cells.map((_, index) => ({
			id: `c${index}`,
			parentId: '@root',
			row: Math.floor(index / columns),
			column: index % columns,
		})),
		cellByEndpointId: new Map(
			cells.flatMap((members, index) => members.map((id) => [id, `c${index}`] as const)),
		),
		minimumColumnWidths: Array.from({ length: columns }, () => 300),
		minimumRowHeights: Array.from({ length: cells.length / columns }, () => 200),
	};
	const prepared = prepareLayoutDocument(document);
	const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
	if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
	expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	return result;
}

describe('coherent grid bus and rail nesting', () => {
	it.each(FLOWS)('does not cross disjoint traversals three times in $direction', (flow) => {
		const result = busWitness(
			2,
			[['a'], ['b'], ['c'], ['d'], ['e'], ['f']],
			[
				['f', 'a'],
				['d', 'c'],
			],
			flow,
		);
		expect(routeBridgeAnalysis(result.layout.relations).crossings.length).toBeLessThanOrEqual(1);
	});
	it.each(FLOWS)(
		'removes avoidable bus crossings from the two by two witness in $direction',
		(flow) => {
			const result = busWitness(
				2,
				[['a1', 'a2'], ['b'], ['c'], ['d']],
				[
					['a2', 'a1'],
					['d', 'a2'],
					['b', 'a1'],
				],
				flow,
			);
			// Coherent bus ordinals (G-03) with direct passages between neighbours (G-02): no crossing left.
			expect(routeBridgeAnalysis(result.layout.relations).crossings).toHaveLength(0);
		},
	);
});

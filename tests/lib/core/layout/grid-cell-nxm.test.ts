import { describe, expect, it } from 'vitest';

import { solveGridCellLayout } from '../../../../src/lib/core/layout/grid-cell-layout';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grid-cell-validation';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import { RegionCompositionStatus } from '../../../../src/lib/core/layout/region-composition-types';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	nxmThreeByTwoDocument,
	nxmThreeByTwoInput,
	nxmTwoByThreeDocument,
	nxmTwoByThreeInput,
	persistedNxmGridDocument,
} from './grid-cell-fixture';

interface NxmShape {
	readonly name: string;
	readonly document: () => ReturnType<typeof nxmThreeByTwoDocument>;
	readonly input: () => GridCellInput;
	readonly columns: number;
	readonly rows: number;
}

const SHAPES: readonly NxmShape[] = [
	{
		name: 'three by two',
		document: nxmThreeByTwoDocument,
		input: nxmThreeByTwoInput,
		columns: 3,
		rows: 2,
	},
	{
		name: 'two by three',
		document: nxmTwoByThreeDocument,
		input: nxmTwoByThreeInput,
		columns: 2,
		rows: 3,
	},
];

describe('N by M grid composition', () => {
	it.each(SHAPES)(
		'places and routes the $name grid through the production composition and validators',
		({ document, input, columns, rows }) => {
			const source = document();
			const cellInput = input();
			const prepared = prepareLayoutDocument(source);
			const result = solveGridCellLayout(prepared.graph, prepared.measurements, cellInput);
			if (result.status !== GridCellLayoutStatus.Selected)
				throw new Error(`${result.status}: ${result.reason}`);
			expect(result.columnWidths).toHaveLength(columns);
			expect(result.rowHeights).toHaveLength(rows);
			expect(result.cells).toHaveLength(columns * rows);
			expect(result.cells.map(({ row, column }) => `${row}:${column}`)).toEqual(
				Array.from({ length: rows }, (_, row) =>
					Array.from({ length: columns }, (_, column) => `${row}:${column}`),
				).flat(),
			);
			// Every cell fills exactly the tracks of its row and column.
			for (const cell of result.cells) {
				expect(cell.bounds.width).toBe(result.columnWidths[cell.column]);
				expect(cell.bounds.height).toBe(result.rowHeights[cell.row]);
			}
			expect(validateGridCellGeometry(result, prepared.graph, cellInput)).toBeUndefined();
		},
	);

	it('routes the inward crossing of a three by two grid through its inner gutter', () => {
		const cellInput = nxmThreeByTwoInput();
		const prepared = prepareLayoutDocument(nxmThreeByTwoDocument());
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, cellInput);
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error(`${result.status}: ${result.reason}`);
		const firstColumn = result.cells.find(({ column }) => column === 0);
		const secondColumn = result.cells.find(({ column }) => column === 1);
		if (firstColumn === undefined || secondColumn === undefined)
			throw new Error('Expected the two leading columns.');
		const route = result.layout.relations.find(({ id }) => id === 'a-b');
		if (route === undefined) throw new Error('Expected the inward crossing.');
		const innerGutter = route.points.some(
			({ x }) => x > firstColumn.bounds.x + firstColumn.bounds.width && x < secondColumn.bounds.x,
		);
		expect(innerGutter).toBe(true);
	});

	it('is invariant to permutation of the document, cells and ownership entries', () => {
		const source = nxmThreeByTwoDocument();
		const cellInput = nxmThreeByTwoInput();
		const baseline = prepareLayoutDocument(source, undefined);
		const permuted = prepareLayoutDocument({
			...source,
			nodes: [...source.nodes].reverse(),
			relations: [...source.relations].reverse(),
		});
		const permutedInput: GridCellInput = {
			...cellInput,
			cells: [...cellInput.cells].reverse(),
			cellByEndpointId: new Map([...cellInput.cellByEndpointId].reverse()),
		};
		const permutedMeasurements = {
			...permuted.measurements,
			nodes: new Map([...permuted.measurements.nodes].reverse()),
		};
		expect(solveGridCellLayout(permuted.graph, permutedMeasurements, permutedInput)).toEqual(
			solveGridCellLayout(baseline.graph, baseline.measurements, cellInput),
		);
	});
});

describe('N by M grid region arrangement', () => {
	it('composes the persisted three by two grid through the recursive arrangement', () => {
		const prepared = prepareLayoutDocument(persistedNxmGridDocument(), undefined);
		const attempt = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			nestedRegionInput(prepared.graph),
		);
		if (attempt.status !== RegionCompositionStatus.Selected)
			throw new Error(`${attempt.status}: ${attempt.reason}`);
		expect(attempt.regions).toHaveLength(6);
		expect(attempt.layout.relations).toHaveLength(3);
		const columns = new Map(attempt.regions.map(({ id, bounds }) => [id, bounds.x]));
		expect(columns.get('a')).toBe(columns.get('d'));
		expect(columns.get('b')).toBe(columns.get('e'));
		expect(columns.get('c')).toBe(columns.get('f'));
		expect(columns.get('a')).toBeLessThan(columns.get('b') ?? 0);
		expect(columns.get('b')).toBeLessThan(columns.get('c') ?? 0);
	});
});

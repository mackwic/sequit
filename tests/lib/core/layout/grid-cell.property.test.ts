import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { solveGridCellLayout } from '../../../../src/lib/core/layout/grid-cell-layout';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grid-cell-validation';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { orthogonalPathsTouch } from '../../../../src/lib/core/layout/nested-region-geometry-primitives';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { gridDocument, gridInput } from './grid-cell-fixture';

/** The grid owns the middle piece of each crossing route: the contact oracle compares those. */
function gridOwnedContact(
	layout: LayoutResult,
	input: GridCellInput,
): readonly [string, string] | undefined {
	const crossing = layout.relations.filter(
		(route) => input.cellByEndpointId.get(route.from) !== input.cellByEndpointId.get(route.to),
	);
	for (const [index, first] of crossing.entries())
		for (const second of crossing.slice(index + 1))
			if (orthogonalPathsTouch(first.points.slice(1, -1), second.points.slice(1, -1)))
				return [first.id, second.id];
	return undefined;
}

const fractionalSize = fc.record({
	width: fc.integer({ min: 80, max: 320 }).map((value) => value + 0.25),
	height: fc.integer({ min: 40, max: 160 }).map((value) => value + 0.5),
});

describe('grid-cell real-pipeline properties', () => {
	it('keeps independent cells and three opaque crossings under fractional sizes and permutations', () => {
		fc.assert(
			fc.property(
				fc.record({
					aTop: fractionalSize,
					aBottom: fractionalSize,
					b: fractionalSize,
					c: fractionalSize,
					d: fractionalSize,
					groupWidth: fc.integer({ min: 400, max: 900 }).map((value) => value + 0.25),
					groupHeight: fc.integer({ min: 240, max: 600 }).map((value) => value + 0.5),
					minimumColumns: fc.tuple(
						fc.integer({ min: 0, max: 1000 }),
						fc.integer({ min: 0, max: 1000 }),
					),
					minimumRows: fc.tuple(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 0, max: 700 })),
				}),
				(values) => {
					const base = gridDocument();
					const document = {
						...base,
						relations: [
							...base.relations,
							{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
							{ id: 'third-crossing', from: 'a-top', to: 'd' },
						],
					};
					const overrides = {
						nodes: {
							'a-top': values.aTop,
							'a-bottom': values.aBottom,
							b: values.b,
							c: values.c,
							d: values.d,
						},
						groups: {
							oversized: {
								minimumWidth: values.groupWidth,
								minimumHeight: values.groupHeight,
								headerHeight: 36,
								padding: 24,
							},
						},
					};
					const input = {
						...gridInput(),
						minimumColumnWidths: values.minimumColumns,
						minimumRowHeights: values.minimumRows,
					};
					const cold = prepareLayoutDocument(document, overrides);
					const solved = solveGridCellLayout(cold.graph, cold.measurements, input);
					if (solved.status !== GridCellLayoutStatus.Selected)
						throw new Error(`Expected selected grid: ${solved.status}: ${solved.reason}`);
					expect(validateGridCellGeometry(solved, cold.graph, input)).toBeUndefined();
					expect(gridOwnedContact(solved.layout, input)).toBeUndefined();
					expect(solved.portals).toHaveLength(6);
					expect(solved.columnWidths[0]).toBeGreaterThanOrEqual(values.minimumColumns[0]);
					expect(solved.columnWidths[1]).toBeGreaterThanOrEqual(values.minimumColumns[1]);
					expect(solved.rowHeights[0]).toBeGreaterThanOrEqual(values.minimumRows[0]);
					expect(solved.rowHeights[1]).toBeGreaterThanOrEqual(values.minimumRows[1]);
					const permuted = prepareLayoutDocument(
						{
							...document,
							nodes: [...document.nodes].reverse(),
							groups: [...document.groups].reverse(),
							relations: [...document.relations].reverse(),
						},
						overrides,
					);
					const reversedInput = {
						...input,
						cells: [...input.cells].reverse(),
						cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
					};
					const reversedMeasurements = {
						...permuted.measurements,
						nodes: new Map([...permuted.measurements.nodes].reverse()),
						groups: new Map([...permuted.measurements.groups].reverse()),
					};
					expect(solveGridCellLayout(permuted.graph, reversedMeasurements, reversedInput)).toEqual(
						solved,
					);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});

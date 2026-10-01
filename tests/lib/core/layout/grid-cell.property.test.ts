import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	type LogicNode,
	type LogicRelation,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { unbridgedContacts } from '../../../../src/lib/core/layout/bridges/bridge-contact';
import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import {
	GRID_CROSSING_BRIDGE_BUDGET,
	GRID_CROSSING_EXTRA_TRACK_BUDGET,
	GRID_CROSSING_REALLOCATION_BUDGET,
	GRID_CROSSING_ROW_GUTTER_BUDGET,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { entersInterior } from '../../../../src/lib/core/layout/grids/grid-cell-geometry-primitives';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grids/grid-cell-validation';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	gridOf,
	gridWithLocalRelations,
} from '../../../support/performance/layout-resource-scenarios';

const fractionalSize = fc.record({
	width: fc.integer({ min: 80, max: 320 }).map((value) => value + 0.25),
	height: fc.integer({ min: 40, max: 160 }).map((value) => value + 0.5),
});

interface GridShape {
	readonly rows: number;
	readonly columns: number;
}

function nodeId(row: number, column: number): string {
	return `${row}-${column}`;
}

function cellInput(
	shape: GridShape,
	minimumColumns: readonly number[],
	minimumRows: readonly number[],
): GridCellInput {
	const cells = [];
	const cellByEndpointId = new Map<string, string>();
	for (let row = 0; row < shape.rows; row += 1)
		for (let column = 0; column < shape.columns; column += 1) {
			const id = nodeId(row, column);
			cells.push({ id, parentId: '@root', row, column });
			cellByEndpointId.set(id, id);
		}
	return {
		rootId: '@root',
		cells,
		cellByEndpointId,
		minimumColumnWidths: minimumColumns.slice(0, shape.columns),
		minimumRowHeights: minimumRows.slice(0, shape.rows),
	};
}

function gridDocument(shape: GridShape): LogicDocument {
	const nodes: LogicNode[] = [];
	let order = 0;
	for (let row = 0; row < shape.rows; row += 1)
		for (let column = 0; column < shape.columns; column += 1) {
			const id = nodeId(row, column);
			nodes.push({
				kind: EndpointKind.Node,
				id,
				natureId: 'task',
				markdown: `${id}\n`,
				layoutOrder: orderKey(`a${order}`),
			});
			order += 1;
		}
	const relations: LogicRelation[] = [];
	for (let row = 0; row < shape.rows; row += 1)
		relations.push({
			id: `right-${row}`,
			from: nodeId(row, 0),
			to: nodeId(row, 1),
		});
	if (shape.rows > 1)
		relations.push({
			id: 'down-leading',
			from: nodeId(0, 0),
			to: nodeId(shape.rows - 1, 0),
		});
	if (shape.columns > 2)
		relations.push({
			id: 'right-trailing',
			from: nodeId(0, shape.columns - 2),
			to: nodeId(0, shape.columns - 1),
		});
	return {
		persistenceFormat: 2,
		id: 'grid-property',
		title: 'Grid property',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes,
		relations,
	};
}

function nodeOverrides(
	shape: GridShape,
	sizes: readonly { readonly width: number; readonly height: number }[],
): Record<string, { readonly width: number; readonly height: number }> {
	const overrides: Record<string, { readonly width: number; readonly height: number }> = {};
	for (let row = 0; row < shape.rows; row += 1)
		for (let column = 0; column < shape.columns; column += 1) {
			const size = sizes[row * 3 + column];
			if (size !== undefined) overrides[nodeId(row, column)] = size;
		}
	return overrides;
}

/** The grid owns the middle piece of each crossing route: the contact oracle compares those. */
function gridOwnedUnbridgedContact(
	layout: LayoutResult,
	input: GridCellInput,
): readonly [string, string] | undefined {
	const crossing = layout.relations.filter(
		(route) => input.cellByEndpointId.get(route.from) !== input.cellByEndpointId.get(route.to),
	);
	const bridges = validatedBridges(layout.relations);
	for (const [index, first] of crossing.entries())
		for (const second of crossing.slice(index + 1)) {
			const unbridged = unbridgedContacts(
				{ id: first.id, points: first.points.slice(1, -1) },
				{ id: second.id, points: second.points.slice(1, -1) },
				bridges,
			);
			if (unbridged.length > 0) return [first.id, second.id];
		}
	return undefined;
}

describe('grid-cell real-pipeline properties', () => {
	it('keeps partially empty grids valid and invariant under permutations in every direction', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 2, max: 3 }),
				fc.integer({ min: 2, max: 3 }),
				fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
				fc.integer({ min: 0, max: 8 }),
				fc.integer({ min: 0, max: 8 }),
				fc.integer({ min: 0, max: 8 }),
				fc.integer({ min: 0, max: 600 }),
				fc.integer({ min: 0, max: 600 }),
				(
					rows,
					columns,
					occupied,
					emptyOffset,
					sourceOffset,
					targetOffset,
					minimumWidth,
					minimumHeight,
				) => {
					const shape = { rows, columns };
					const base = gridDocument(shape);
					const count = base.nodes.length;
					const emptyIndex = emptyOffset % count;
					const firstPopulated = (emptyIndex + 1) % count;
					const secondPopulated = (emptyIndex + 2) % count;
					const nodes = base.nodes.filter((_, index) => {
						if (index === emptyIndex) return false;
						return (
							index === firstPopulated || index === secondPopulated || occupied[index] === true
						);
					});
					const sourceIndex = sourceOffset % nodes.length;
					let targetIndex = targetOffset % nodes.length;
					if (targetIndex === sourceIndex) targetIndex = (targetIndex + 1) % nodes.length;
					const relations = [
						{
							id: 'empty-grid-crossing',
							from: defined(nodes[sourceIndex]).id,
							to: defined(nodes[targetIndex]).id,
						},
					];
					const ids = new Set(nodes.map(({ id }) => id));
					const baseInput = cellInput(
						shape,
						[minimumWidth, minimumWidth, minimumWidth],
						[minimumHeight, minimumHeight, minimumHeight],
					);
					const input = {
						...baseInput,
						cellByEndpointId: new Map(
							[...baseInput.cellByEndpointId].filter(([id]) => ids.has(id)),
						),
					};
					for (const direction of Object.values(LayoutDirection)) {
						const document = {
							...base,
							layout: defined(
								layoutConfiguration(direction, LayoutBias.Top) ??
									layoutConfiguration(direction, LayoutBias.Left),
							),
							nodes,
							relations,
						};
						const prepared = prepareLayoutDocument(document);
						const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
						if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
						expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
						for (const cell of result.cells) {
							expect(cell.bounds.width).toBeGreaterThanOrEqual(Math.max(64, minimumWidth));
							expect(cell.bounds.height).toBeGreaterThanOrEqual(Math.max(64, minimumHeight));
						}
						for (const cell of result.cells) {
							if (ids.has(cell.id)) continue;
							for (const route of result.layout.relations)
								for (let index = 1; index < route.points.length; index += 1)
									expect(
										entersInterior(
											defined(route.points[index - 1]),
											defined(route.points[index]),
											cell.bounds,
										),
									).toBe(false);
						}
						const reversed = prepareLayoutDocument({ ...document, nodes: [...nodes].reverse() });
						expect(
							solveGridCellLayout(reversed.graph, reversed.measurements, {
								...input,
								cells: [...input.cells].reverse(),
								cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
							}),
						).toEqual(result);
					}
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
	it('selects valid geometry beyond either old cardinality guard under permutations and metric edits', () => {
		fc.assert(
			fc.property(
				fc.boolean(),
				fc.integer({ min: 80, max: 400 }),
				fc.integer({ min: 0, max: 300 }),
				(localRelations, width, minimumHeight) => {
					let scene = gridOf(3, 7);
					if (localRelations) scene = gridWithLocalRelations();
					const { document, input } = scene;
					const first = document.nodes[0];
					if (first === undefined) throw new Error('Expected a populated grid');
					const changed = {
						...input,
						minimumRowHeights: input.minimumRowHeights.map(() => minimumHeight),
					};
					const prepared = prepareLayoutDocument(document, {
						nodes: { [first.id]: { width, height: 80 } },
					});
					const solved = solveGridCellLayout(prepared.graph, prepared.measurements, changed);
					if (solved.status !== GridCellLayoutStatus.Selected)
						throw new Error(`Expected selected grid: ${solved.status}: ${solved.reason}`);
					expect(validateGridCellGeometry(solved, prepared.graph, changed)).toBeUndefined();
					expect(solved.layout.relations).toHaveLength(document.relations.length);
					const reversed = prepareLayoutDocument(
						{
							...document,
							nodes: [...document.nodes].reverse(),
							relations: [...document.relations].reverse(),
						},
						{ nodes: { [first.id]: { width, height: 80 } } },
					);
					expect(
						solveGridCellLayout(reversed.graph, reversed.measurements, {
							...changed,
							cells: [...changed.cells].reverse(),
							cellByEndpointId: new Map([...changed.cellByEndpointId].reverse()),
						}),
					).toEqual(solved);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
	it('keeps independent cells and opaque crossings across two and three by two and three grids', () => {
		fc.assert(
			fc.property(
				fc.record({
					rows: fc.constantFrom(2, 3),
					columns: fc.constantFrom(2, 3),
					sizes: fc.array(fractionalSize, { minLength: 9, maxLength: 9 }),
					minimumColumns: fc.array(fc.integer({ min: 0, max: 1000 }), {
						minLength: 3,
						maxLength: 3,
					}),
					minimumRows: fc.array(fc.integer({ min: 0, max: 700 }), {
						minLength: 3,
						maxLength: 3,
					}),
				}),
				({ rows, columns, sizes, minimumColumns, minimumRows }) => {
					const shape: GridShape = { rows, columns };
					const document = gridDocument(shape);
					const input = cellInput(shape, minimumColumns, minimumRows);
					const overrides = { nodes: nodeOverrides(shape, sizes) };
					const cold = prepareLayoutDocument(document, overrides);
					const solved = solveGridCellLayout(cold.graph, cold.measurements, input);
					if (solved.status !== GridCellLayoutStatus.Selected)
						throw new Error(`Expected selected grid: ${solved.status}: ${solved.reason}`);
					expect(validateGridCellGeometry(solved, cold.graph, input)).toBeUndefined();
					const budgets = new Map([
						['row-gutter', GRID_CROSSING_ROW_GUTTER_BUDGET],
						['reallocate', GRID_CROSSING_REALLOCATION_BUDGET],
						['extra-track', GRID_CROSSING_EXTRA_TRACK_BUDGET],
						['bridge', GRID_CROSSING_BRIDGE_BUDGET],
					]);
					expect(solved.witness.attempted).toBe(
						solved.witness.phases.reduce((sum, phase) => sum + phase.exploredGeometries, 0),
					);
					for (const phase of solved.witness.phases) {
						const explored = phase.exploredGeometries;
						const total = BigInt(phase.totalGeometries);
						const budget = budgets.get(phase.id);
						if (budget === undefined) throw new Error('Missing grid phase budget.');
						expect(explored).toBeLessThanOrEqual(budget);
						if (!phase.attempted) {
							expect([explored, phase.exhaustive, phase.truncated, phase.selected]).toEqual([
								0,
								false,
								false,
								false,
							]);
							continue;
						}
						if (phase.exhaustive) expect(BigInt(explored)).toBe(total);
						if (phase.truncated) {
							expect(explored).toBe(budget);
							expect(BigInt(explored)).toBeLessThan(total);
							expect(phase.selected).toBe(false);
						}
						if (!phase.exhaustive && !phase.selected) expect(phase.truncated).toBe(true);
						if (phase.selected) expect(phase.id).toBe(solved.witness.winningPhase);
					}
					expect(gridOwnedUnbridgedContact(solved.layout, input)).toBeUndefined();
					expect(solved.portals).toHaveLength(2 * document.relations.length);
					for (const [index, minimum] of input.minimumColumnWidths.entries())
						expect(solved.columnWidths[index]).toBeGreaterThanOrEqual(minimum);
					for (const [index, minimum] of input.minimumRowHeights.entries())
						expect(solved.rowHeights[index]).toBeGreaterThanOrEqual(minimum);
					const permuted = prepareLayoutDocument(
						{
							...document,
							nodes: [...document.nodes].reverse(),
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
					};
					expect(solveGridCellLayout(permuted.graph, reversedMeasurements, reversedInput)).toEqual(
						solved,
					);
				},
			),
			PROPERTY_PARAMETERS,
		);
	}, 600_000);
});

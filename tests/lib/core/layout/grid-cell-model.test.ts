import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
	type LogicDocument,
	type LogicGroup,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import {
	type GridCellDefinition,
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grids/grid-cell-validation';
import { gridDocument, gridInput, prepareGrid } from './grid-cell-fixture';

function graphFor(document: LogicDocument): LogicGraph {
	const result = createGraph(document);
	if (!result.ok) throw new Error('Expected a valid graph fixture');
	return result.value;
}

function rejected(graph: LogicGraph, input: GridCellInput, reason: string): void {
	const result = solveGridCellLayout(graph, prepareGrid().measurements, input);
	expect(result).toMatchObject({ status: GridCellLayoutStatus.Unsupported, reason });
}

function changeCell(
	input: GridCellInput,
	id: string,
	replacement: Partial<GridCellDefinition>,
): GridCellInput {
	return {
		...input,
		cells: input.cells.map((cell) => {
			if (cell.id !== id) return cell;
			return { ...cell, ...replacement };
		}),
	};
}

describe('grid model envelope', () => {
	const prepared = prepareGrid();
	const input = gridInput();

	it('rejects non-grid presentations and junctions', () => {
		const base = gridDocument();
		const withRegions: LogicDocument = {
			...base,
			regionPresentation: { schemaVersion: 1, regions: [] },
		};
		rejected(
			graphFor(withRegions),
			input,
			'Only a persisted grid region presentation can use this grid policy.',
		);
		const withJunction: LogicDocument = {
			...base,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'junction',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a5'),
				},
			],
		};
		rejected(graphFor(withJunction), input, 'Junctions are outside this bounded grid proof.');
	});

	it('keeps a valid root lane document outside the grid disposition', () => {
		const base = gridDocument();
		const lanes: LogicDocument = {
			...base,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [
					{ id: 'left', label: 'Left', layoutOrder: orderKey('a0') },
					{ id: 'right', label: 'Right', layoutOrder: orderKey('a1') },
				],
			},
			groups: base.groups.map((group) => ({ ...group, laneId: 'right' })),
			nodes: base.nodes.map((node) => {
				if (node.groupId !== undefined) return node;
				return { ...node, laneId: 'left' };
			}),
		};
		expect(validateLogicDocument(lanes).ok).toBe(true);
		rejected(graphFor(lanes), input, 'Persisted lane presentations are outside this grid policy.');
	});

	const invalidInputs: readonly {
		readonly name: string;
		readonly value: GridCellInput;
		readonly reason: string;
	}[] = [
		{
			name: 'empty root',
			value: { ...input, rootId: '' },
			reason: 'The root identity must be nonempty.',
		},
		{
			name: 'infinite minimum',
			value: { ...input, minimumColumnWidths: [Infinity, 100] },
			reason: 'Track minima must be finite nonnegative dimensions.',
		},
		{
			name: 'negative minimum',
			value: { ...input, minimumRowHeights: [50, -1] },
			reason: 'Track minima must be finite nonnegative dimensions.',
		},
		{
			name: 'three cells',
			value: { ...input, cells: input.cells.slice(0, 3) },
			reason: 'Cells must uniquely cover the root grid rectangle.',
		},
		{
			name: 'empty cell id',
			value: changeCell(input, 'a', { id: '' }),
			reason: 'Cells must uniquely cover the root grid rectangle.',
		},
		{
			name: 'root as cell',
			value: changeCell(input, 'a', { id: '@root' }),
			reason: 'Cells must uniquely cover the root grid rectangle.',
		},
		{
			name: 'wrong parent',
			value: changeCell(input, 'a', { parentId: 'other' }),
			reason: 'Cells must uniquely cover the root grid rectangle.',
		},
		{
			name: 'duplicate coordinate',
			value: changeCell(input, 'd', { row: 0 }),
			reason: 'Cells must uniquely cover the root grid rectangle.',
		},
		{
			name: 'duplicate id',
			value: changeCell(input, 'd', { id: 'a' }),
			reason: 'Cells must uniquely cover the root grid rectangle.',
		},
		{
			name: 'fractional coordinate',
			value: changeCell(input, 'd', { row: 1.5 }),
			reason: 'Cells must uniquely cover the root grid rectangle.',
		},
		{
			name: 'negative coordinate',
			value: changeCell(input, 'd', { column: -1 }),
			reason: 'Cells must uniquely cover the root grid rectangle.',
		},
		{
			name: 'no cells',
			value: { ...input, cells: [] },
			reason: 'At least one direct child cell is required.',
		},
		{
			name: 'minima that do not match the rectangle',
			value: { ...input, minimumColumnWidths: [700] },
			reason: 'Grid track minima must match the cell rectangle.',
		},
	];
	it.each(invalidInputs)('rejects $name', ({ value, reason }) => {
		rejected(prepared.graph, value, reason);
	});

	it('rejects missing and unknown endpoint assignments without requiring occupied cells', () => {
		const missing = new Map(input.cellByEndpointId);
		missing.delete('a-top');
		rejected(
			prepared.graph,
			{ ...input, cellByEndpointId: missing },
			'Every endpoint must be assigned to exactly one child cell.',
		);
		const unknown = new Map(input.cellByEndpointId);
		unknown.set('a-top', 'foreign');
		rejected(
			prepared.graph,
			{ ...input, cellByEndpointId: unknown },
			'Every endpoint must be assigned to exactly one child cell.',
		);
		const withEmptyCell = new Map(input.cellByEndpointId);
		withEmptyCell.set('c', 'd');
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, {
			...input,
			cellByEndpointId: withEmptyCell,
		});
		if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
		expect(result.cells.find(({ id }) => id === 'c')?.localLayout.elements).toEqual([]);
		expect(
			validateGridCellGeometry(result, prepared.graph, {
				...input,
				cellByEndpointId: withEmptyCell,
			}),
		).toBeUndefined();
	});

	it('refuses an entirely empty grid rather than publishing a placeholder layout', () => {
		const base = gridDocument();
		const document = { ...base, nodes: [], groups: [], relations: [] };
		rejected(
			graphFor(document),
			{ ...input, cellByEndpointId: new Map() },
			'An entirely empty grid is not supported; at least one cell must own an endpoint.',
		);
	});

	it('keeps a group and its member indivisible within one child', () => {
		const split = new Map(input.cellByEndpointId);
		split.set('oversized', 'c');
		rejected(
			prepared.graph,
			{ ...input, cellByEndpointId: split },
			'A group and all its members must occupy one indivisible child cell.',
		);
		const base = gridDocument();
		const nestedGroup: LogicGroup = {
			kind: EndpointKind.Group,
			id: 'nested',
			label: 'Nested',
			groupId: 'oversized',
			layoutOrder: orderKey('a6'),
		};
		const withNested = graphFor({ ...base, groups: [...base.groups, nestedGroup] });
		const nestedAssignment = new Map(input.cellByEndpointId);
		nestedAssignment.set('nested', 'c');
		rejected(
			withNested,
			{ ...input, cellByEndpointId: nestedAssignment },
			'A group and all its members must occupy one indivisible child cell.',
		);
	});

	it('submits grouped endpoints to the same geometry proof as other crossings', () => {
		const base = gridDocument();
		const cases: { readonly document: LogicDocument; readonly input: GridCellInput }[] = [
			{
				document: {
					...base,
					relations: [{ id: 'grouped-node-cross', from: 'b', to: 'd' }],
				},
				input,
			},
		];
		const nested: LogicGroup = {
			kind: EndpointKind.Group,
			id: 'nested',
			label: 'Nested',
			groupId: 'oversized',
			layoutOrder: orderKey('a6'),
		};
		cases.push({
			document: {
				...base,
				groups: [...base.groups, nested],
				relations: [{ id: 'nested-cross', from: 'nested', to: 'd' }],
			},
			input: { ...input, cellByEndpointId: new Map(input.cellByEndpointId).set('nested', 'b') },
		});
		const other: LogicGroup = {
			kind: EndpointKind.Group,
			id: 'other-group',
			label: 'Other',
			layoutOrder: orderKey('a7'),
		};
		cases.push({
			document: {
				...base,
				groups: [...base.groups, other],
				relations: [{ id: 'group-pair', from: 'oversized', to: 'other-group' }],
			},
			input: {
				...input,
				cellByEndpointId: new Map(input.cellByEndpointId).set('other-group', 'd'),
			},
		});
		for (const fixture of cases) {
			const preparedCase = prepareGrid(fixture.document);
			const result = solveGridCellLayout(
				preparedCase.graph,
				preparedCase.measurements,
				fixture.input,
			);
			expect(result.status).toBe(GridCellLayoutStatus.Selected);
			if (result.status !== GridCellLayoutStatus.Selected) continue;
			expect(validateGridCellGeometry(result, preparedCase.graph, fixture.input)).toBeUndefined();
		}
	});
});

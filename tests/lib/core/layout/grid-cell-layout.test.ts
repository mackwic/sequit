import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grid-cell-layout';
import {
	type GridCellInput,
	GridCellLayoutStatus,
	GridCellSide,
} from '../../../../src/lib/core/layout/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grid-cell-validation';
import { gridDocument, gridInput, prepareGrid } from './grid-cell-fixture';

describe('bounded two by two grid composition', () => {
	it('can compose the same grid in the local coordinates of a named region', () => {
		const prepared = prepareGrid();
		const rootInput = gridInput();
		const regionId = 'inner-grid';
		const innerInput: GridCellInput = {
			...rootInput,
			rootId: regionId,
			cells: rootInput.cells.map((cell) => ({ ...cell, parentId: regionId })),
		};
		const root = solveGridCellLayout(prepared.graph, prepared.measurements, rootInput);
		const inner = solveGridCellLayout(prepared.graph, prepared.measurements, innerInput);
		expect(root.status).toBe(GridCellLayoutStatus.Selected);
		expect(inner.status).toBe(GridCellLayoutStatus.Selected);
		if (root.status !== GridCellLayoutStatus.Selected) return;
		if (inner.status !== GridCellLayoutStatus.Selected) return;
		expect(inner.rootId).toBe(regionId);
		expect(inner.cells.every(({ parentId }) => parentId === regionId)).toBe(true);
		expect(inner.layout).toEqual(root.layout);
		expect(validateGridCellGeometry(inner, prepared.graph, innerInput)).toBeUndefined();
	});

	it('solves independent child ranks, extends only required tracks, and routes outside opaque cells', () => {
		const prepared = prepareGrid();
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		expect(result.cells.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
		expect(result.cells[0]?.localRanks.byEndpointId.get('a-bottom')).toBe(1);
		expect(result.cells[0]?.localRanks.byEndpointId.get('a-top')).toBe(0);
		expect(result.cells[3]?.localRanks.byEndpointId.get('d')).toBe(0);
		expect(result.columnWidths[0]).toBe(700);
		expect(result.columnWidths[1]).toBeGreaterThan(620);
		expect(result.rowHeights[0]).toBeGreaterThan(320);
		expect(result.rowHeights[1]).toBe(300);
		const group = result.layout.elements.find(({ id }) => id === 'oversized');
		const member = result.layout.elements.find(({ id }) => id === 'b');
		expect(group).toBeDefined();
		expect(member).toBeDefined();
		if (group === undefined || member === undefined) return;
		expect(group.bounds.width).toBeGreaterThanOrEqual(620);
		expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(group.bounds.x + group.bounds.width);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});

	it('is invariant to permutation of document, cells, and ownership entries', () => {
		const original = gridDocument();
		const input = gridInput();
		const baseline = prepareGrid(original);
		const permuted = prepareGrid({
			...original,
			nodes: [...original.nodes].reverse(),
			groups: [...original.groups].reverse(),
			relations: [...original.relations].reverse(),
		});
		const permutedInput: GridCellInput = {
			...input,
			cells: [...input.cells].reverse(),
			cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
		};
		expect(solveGridCellLayout(permuted.graph, permuted.measurements, permutedInput)).toEqual(
			solveGridCellLayout(baseline.graph, baseline.measurements, input),
		);
	});

	it('uses one exterior rail when both endpoint cells share a column', () => {
		const document = gridDocument();
		const prepared = prepareGrid({
			...document,
			relations: document.relations.map((relation) => {
				if (relation.id !== 'across-grid') return relation;
				return { ...relation, to: 'c' };
			}),
		});
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});

	it('allocates distinct ports and exterior tracks to multiple crossing relations', () => {
		const document = gridDocument();
		const withCrossings: LogicDocument = {
			...document,
			relations: [
				...document.relations,
				{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
				{ id: 'third-crossing', from: 'a-top', to: 'd' },
			],
		};
		const input = gridInput();
		const prepared = prepareGrid(withCrossings);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		const routes = new Map(result.layout.relations.map((route) => [route.id, route]));
		expect(routes.get('across-grid')?.points[0]).not.toEqual(
			routes.get('second-crossing')?.points[0],
		);
		expect(routes.get('across-grid')?.points.at(-1)).not.toEqual(
			routes.get('third-crossing')?.points.at(-1),
		);
		expect(new Set(result.portals.map(({ relationId }) => relationId)).size).toBe(3);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();

		const reversed = prepareGrid({
			...withCrossings,
			relations: [...withCrossings.relations].reverse(),
		});
		expect(solveGridCellLayout(reversed.graph, reversed.measurements, input)).toEqual(result);
	});

	it('connects local rank four to local rank one without imposing a shared inter-cell rank', () => {
		const base = gridDocument();
		const document: LogicDocument = {
			...base,
			nodes: [
				...base.nodes.filter(({ id }) => id !== 'd'),
				{
					kind: EndpointKind.Node,
					id: 'a-two',
					natureId: 'task',
					markdown: 'A two\n',
					layoutOrder: orderKey('a5'),
				},
				{
					kind: EndpointKind.Node,
					id: 'a-three',
					natureId: 'task',
					markdown: 'A three\n',
					layoutOrder: orderKey('a6'),
				},
				{
					kind: EndpointKind.Node,
					id: 'source-rank-four',
					natureId: 'task',
					markdown: 'Source\n',
					layoutOrder: orderKey('a7'),
				},
				{
					kind: EndpointKind.Node,
					id: 'target-rank-one',
					natureId: 'task',
					markdown: 'Target\n',
					layoutOrder: orderKey('a8'),
				},
				{
					kind: EndpointKind.Node,
					id: 'd-sink',
					natureId: 'task',
					markdown: 'D sink\n',
					layoutOrder: orderKey('a9'),
				},
			],
			relations: [
				{ id: 'inside-a', from: 'a-bottom', to: 'a-top' },
				{ id: 'a-two-to-one', from: 'a-two', to: 'a-bottom' },
				{ id: 'a-three-to-two', from: 'a-three', to: 'a-two' },
				{ id: 'a-four-to-three', from: 'source-rank-four', to: 'a-three' },
				{ id: 'd-one-to-zero', from: 'target-rank-one', to: 'd-sink' },
				{ id: 'across-grid', from: 'source-rank-four', to: 'target-rank-one' },
			],
		};
		const input = gridInput();
		const ownership = new Map(input.cellByEndpointId);
		ownership.delete('d');
		for (const id of ['a-two', 'a-three', 'source-rank-four']) ownership.set(id, 'a');
		for (const id of ['target-rank-one', 'd-sink']) ownership.set(id, 'd');
		const prepared = prepareGrid(document);
		const configured = { ...input, cellByEndpointId: ownership };
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, configured);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		expect(result.cells[0]?.localRanks.byEndpointId.get('source-rank-four')).toBe(4);
		expect(result.cells[3]?.localRanks.byEndpointId.get('target-rank-one')).toBe(1);
		expect(
			result.layout.relations.find(({ id }) => id === 'across-grid')?.points.length,
		).toBeGreaterThan(2);
		expect(validateGridCellGeometry(result, prepared.graph, configured)).toBeUndefined();
	});

	it('independently rejects a route that enters an opaque foreign cell', () => {
		const prepared = prepareGrid();
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error('Expected selected fixture');
		const route = result.layout.relations.find(({ id }) => id === 'across-grid');
		const foreign = result.cells.find(({ id }) => id === 'b');
		if (route === undefined || foreign === undefined)
			throw new Error('Expected route and foreign cell');
		const rail = route.points[route.points.length - 3];
		if (rail === undefined) throw new Error('Expected right rail');
		const y = foreign.bounds.y + foreign.bounds.height / 2;
		const x = foreign.bounds.x + foreign.bounds.width / 2;
		const points = [
			...route.points.slice(0, -3),
			{ x: rail.x, y },
			{ x, y },
			{ x: rail.x, y },
			...route.points.slice(-3),
		];
		const damaged = {
			...result,
			layout: {
				...result.layout,
				relations: result.layout.relations.map((item) => {
					if (item.id === route.id) return { ...item, points };
					return item;
				}),
			},
		};
		expect(validateGridCellGeometry(damaged, prepared.graph, input)).toContain('opaque cell b');
	});

	it.each([
		{ id: 'group-outgoing', from: 'oversized', to: 'd', source: true },
		{ id: 'group-incoming', from: 'a-bottom', to: 'oversized', source: false },
	])('attaches a direct cross-cell $id to the outside face of its indivisible group', (edge) => {
		const document = gridDocument();
		const prepared = prepareGrid({
			...document,
			relations: [...document.relations, edge],
		});
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		const group = result.layout.elements.find(({ id }) => id === 'oversized');
		const member = result.layout.elements.find(({ id }) => id === 'b');
		const route = result.layout.relations.find(({ id }) => id === edge.id);
		const groupCell = result.cells.find(({ id }) => id === 'b');
		if (
			group === undefined ||
			member === undefined ||
			route === undefined ||
			groupCell === undefined
		)
			throw new Error('Expected group, member, route and cell');
		let port = route.points[0];
		if (!edge.source) port = route.points.at(-1);
		expect(port?.x).toBe(group.bounds.x + group.bounds.width);
		expect(port?.y).toBeGreaterThan(group.bounds.y);
		expect(port?.y).toBeLessThan(group.bounds.y + group.bounds.height);
		expect(result.portals.filter(({ relationId }) => relationId === edge.id)).toHaveLength(2);
		expect(
			result.portals.find(
				({ relationId, endpointId }) => relationId === edge.id && endpointId === 'oversized',
			),
		).toMatchObject({
			cellId: 'b',
			regionId: 'b',
			side: GridCellSide.Right,
			point: { x: groupCell.bounds.x + groupCell.bounds.width, y: port?.y },
		});
		expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(group.bounds.x + group.bounds.width);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});

	it('rejects a selected group candidate whose member leaves the group but stays in its cell', () => {
		const document = gridDocument();
		const prepared = prepareGrid({
			...document,
			relations: [...document.relations, { id: 'group-cross', from: 'oversized', to: 'd' }],
		});
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error(`Expected selected group candidate: ${result.status}: ${result.reason}`);
		const group = result.layout.elements.find(({ id }) => id === 'oversized');
		const cell = result.cells.find(({ id }) => id === 'b');
		if (group === undefined || cell === undefined) throw new Error('Expected group and cell');
		const changedLocal = {
			x: group.bounds.x + group.bounds.width - cell.translation.x + 4,
			y: group.bounds.y - cell.translation.y + 4,
			width: 8,
			height: 8,
		};
		const changedGlobal = {
			...changedLocal,
			x: changedLocal.x + cell.translation.x,
			y: changedLocal.y + cell.translation.y,
		};
		const damaged = {
			...result,
			cells: result.cells.map((current) => {
				if (current.id !== 'b') return current;
				return {
					...current,
					localLayout: {
						...current.localLayout,
						elements: current.localLayout.elements.map((element) => {
							if (element.id !== 'b') return element;
							return { ...element, bounds: changedLocal };
						}),
					},
				};
			}),
			layout: {
				...result.layout,
				elements: result.layout.elements.map((element) => {
					if (element.id !== 'b') return element;
					return { ...element, bounds: changedGlobal };
				}),
			},
		};
		expect(validateGridCellGeometry(damaged, prepared.graph, input)).toBe(
			'Endpoint b leaves its parent group oversized.',
		);
	});

	it('reports unsupported grid structure explicitly', () => {
		const prepared = prepareGrid();
		const input = gridInput();
		const missing = { ...input, cells: input.cells.slice(0, 3) };
		expect(solveGridCellLayout(prepared.graph, prepared.measurements, missing).status).toBe(
			GridCellLayoutStatus.Unsupported,
		);
	});

	it('reports unresolved geometry when a local sibling blocks the cell exit', () => {
		const prepared = prepareGrid();
		const input = gridInput();
		const blockedFlow: LayoutConfiguration = {
			direction: LayoutDirection.LeftToRight,
			bias: LayoutBias.Left,
		};
		const cells = input.cells.map((cell) => {
			if (cell.id !== 'a') return cell;
			return { ...cell, layout: blockedFlow };
		});
		const attempt = solveGridCellLayout(prepared.graph, prepared.measurements, {
			...input,
			cells,
		});
		expect(attempt.status).toBe(GridCellLayoutStatus.Unknown);
	});
});

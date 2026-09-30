import { describe, expect, it } from 'vitest';

import { localDocument, normalize } from '../../../../src/lib/core/layout/grids/grid-cell-model';
import {
	gridCellRegionLeafDocument,
	normalizeGridCellRegionModel,
} from '../../../../src/lib/core/layout/grids/grid-cell-region-model';
import { solveGridCellRegionLeaves } from '../../../../src/lib/core/layout/grids/grid-cell-region-solver';
import type { GridCellInput } from '../../../../src/lib/core/layout/grids/grid-cell-types';
import {
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import { gridInput, prepareGrid } from './grid-cell-fixture';

function normalizedGrid(input: GridCellInput = gridInput()) {
	const { graph } = prepareGrid();
	const grid = normalize(graph, input);
	if (typeof grid === 'string') throw new Error(grid);
	return { graph, grid };
}

describe('grid cells in the common region ownership model', () => {
	it('keeps spatial child order, indivisible group ownership, and the crossing LCA', () => {
		const input = gridInput();
		const { graph, grid } = normalizedGrid(input);
		const result = normalizeGridCellRegionModel(graph, input, grid);
		expect(result.status).toBe(RegionCompositionModelStatus.Ready);
		if (result.status !== RegionCompositionModelStatus.Ready) return;
		const { model } = result;
		for (const cell of grid.cells)
			expect(gridCellRegionLeafDocument(graph, model, cell.id)).toEqual(
				localDocument(graph, input, grid, cell),
			);
		expect(model.preorderIds).toEqual(['@root', 'a', 'b', 'c', 'd']);
		expect(model.leafByEndpointId).toEqual(
			new Map([
				['a-bottom', 'a'],
				['a-top', 'a'],
				['b', 'b'],
				['c', 'c'],
				['d', 'd'],
				['oversized', 'b'],
			]),
		);
		expect(model.regionsById.get('b')?.definition.layout).toEqual(input.cells[1]?.layout);
		expect(model.localRelationsByOwner.get('a')?.map(({ id }) => id)).toEqual(['inside-a']);
		expect(model.crossingRelationsByOwner.get('@root')?.map(({ id }) => id)).toEqual([
			'across-grid',
		]);
		expect(
			model.relations.map(({ relation, ownerId, kind }) => [relation.id, ownerId, kind]),
		).toEqual([
			['inside-a', 'a', 'local'],
			['across-grid', '@root', 'crossing'],
		]);
		expect(model.relations.find(({ relation }) => relation.id === 'across-grid')).toMatchObject({
			sourceLeafId: 'a',
			targetLeafId: 'd',
			sourcePathToOwner: ['a'],
			targetPathToOwner: ['d'],
		});
	});

	it('normalizes cell and assignment permutations to the same model', () => {
		const input = gridInput();
		const { graph, grid } = normalizedGrid(input);
		const baseline = normalizeGridCellRegionModel(graph, input, grid);
		const permuted: GridCellInput = {
			...input,
			cells: [...input.cells].reverse(),
			cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
		};
		const normalized = normalize(graph, permuted);
		if (typeof normalized === 'string') throw new Error(normalized);
		expect(normalizeGridCellRegionModel(graph, permuted, normalized)).toEqual(baseline);
	});

	it('passes common assignment and resource diagnostics through the adapter', () => {
		const input = gridInput();
		const { graph, grid } = normalizedGrid(input);
		const split = new Map(input.cellByEndpointId);
		split.set('b', 'a');
		expect(
			normalizeGridCellRegionModel(graph, { ...input, cellByEndpointId: split }, grid),
		).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.SplitGroup,
				path: ['endpoints', 'b', 'regionId'],
			},
		});
		const unassigned = new Map(input.cellByEndpointId);
		unassigned.delete('d');
		expect(
			normalizeGridCellRegionModel(graph, { ...input, cellByEndpointId: unassigned }, grid),
		).toMatchObject({
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: {
				code: RegionCompositionDiagnosticCode.MissingEndpointAssignment,
				path: ['endpoints', 'd', 'regionId'],
			},
		});
	});

	it('propagates an invalid local relation partition instead of publishing partial cells', () => {
		const prepared = prepareGrid();
		const input = gridInput();
		const grid = normalize(prepared.graph, input);
		if (typeof grid === 'string') throw new Error(grid);
		const normalized = normalizeGridCellRegionModel(prepared.graph, input, grid);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected a normalized grid model.');
		const localRelationsByOwner = new Map(normalized.model.localRelationsByOwner);
		localRelationsByOwner.set('a', [{ id: 'broken-local', from: 'a-bottom', to: 'missing' }]);
		expect(
			solveGridCellRegionLeaves({
				graph: prepared.graph,
				grid,
				model: { ...normalized.model, localRelationsByOwner },
				measurements: prepared.measurements,
			}),
		).toBeUndefined();
	});
});

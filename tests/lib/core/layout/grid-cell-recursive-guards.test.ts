import { describe, expect, it } from 'vitest';

import { defined, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { composeGridCellDisposition } from '../../../../src/lib/core/layout/grid-cell-layout';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grid-cell-validation';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import { NestedRegionLayoutStatus } from '../../../../src/lib/core/layout/nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedNestedGridWithLaneCellDocument } from './nested-region-fixture';

describe('recursive grid boundaries', () => {
	it('rejects a damaged published lane through the complete grid validator', () => {
		const document = persistedNestedGridWithLaneCellDocument();
		const prepared = prepareLayoutDocument(document);
		const input = nestedRegionInput(prepared.graph);
		const modelBuild = normalizeRegionCompositionModel(prepared.graph, input);
		if (modelBuild.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected a normalized region tree.');
		const selected = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== NestedRegionLayoutStatus.Selected)
			throw new Error(`Expected a selected grid: ${selected.status}: ${selected.reason}`);
		const grid = defined(input.regions.find(({ id }) => id === 'grid')?.grid);
		const cellIds = new Set(grid.cells.map(({ regionId }) => regionId));
		const cellByEndpointId = new Map(
			[...modelBuild.model.leafByEndpointId].filter(([, regionId]) => cellIds.has(regionId)),
		);
		const endpointIds = new Set(cellByEndpointId.keys());
		const localDocument: LogicDocument = {
			persistenceFormat: document.persistenceFormat,
			id: document.id,
			title: document.title,
			layout: document.layout,
			natures: document.natures,
			nodes: document.nodes.filter(({ id }) => endpointIds.has(id)),
			groups: document.groups.filter(({ id }) => endpointIds.has(id)),
			junctions: document.junctions.filter(({ id }) => endpointIds.has(id)),
			relations: document.relations.filter(
				({ from, to }) => endpointIds.has(from) && endpointIds.has(to),
			),
		};
		const graph = createGraph(localDocument);
		if (!graph.ok) throw new Error('Expected the grid subgraph to be valid.');
		const gridInput: GridCellInput = {
			rootId: 'grid',
			cells: grid.cells.map(({ regionId, row, column }) => ({
				id: regionId,
				parentId: 'grid',
				row,
				column,
			})),
			cellByEndpointId,
			minimumColumnWidths: grid.minimumColumnWidths,
			minimumRowHeights: grid.minimumRowHeights,
		};
		const children = grid.cells.map((cell) => {
			const region = defined(selected.regions.find(({ id }) => id === cell.regionId));
			return {
				cell: { id: cell.regionId, parentId: 'grid', row: cell.row, column: cell.column },
				layout: defined(region.localLayout),
				ranks: defined(region.localRanks),
			};
		});
		const composed = composeGridCellDisposition(graph.value, gridInput, modelBuild.model, children);
		if (composed.status !== GridCellLayoutStatus.Selected)
			throw new Error(`Expected a selected grid: ${composed.status}: ${composed.reason}`);
		expect(validateGridCellGeometry(composed, graph.value, gridInput)).toBeUndefined();
		const lanes = defined(composed.layout.lanes);
		const first = defined(lanes[0]);
		const damaged = {
			...composed,
			layout: {
				...composed.layout,
				lanes: [
					{ ...first, bounds: { ...first.bounds, x: first.bounds.x + 1 } },
					...lanes.slice(1),
				],
			},
		};
		expect(validateGridCellGeometry(damaged, graph.value, gridInput)).toBe(
			'Lane left differs from its cell layout.',
		);
	});
});

import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { LayoutMeasurements } from '../layout-types';
import {
	InvalidRegionLeafGraphError,
	solveRegionLeafLayout,
} from '../regions/leaf/region-leaf-layout';
import { regionLeafPolicy } from '../regions/leaf/region-leaf-policy';
import type { RegionCompositionModel } from '../regions/model/region-composition-model';
import type { RegionLocalLayoutCache } from '../regions/model/region-local-cache';
import type { SolvedGridCell } from './grid-cell-disposition';
import {
	gridCellLeafContent,
	GridCellLeafContentKind,
	type GridModel,
	localMeasurements,
} from './grid-cell-model';
import { gridCellRegionLeafDocument } from './grid-cell-region-model';

interface GridRegionSolveInput {
	readonly graph: LogicGraph;
	readonly grid: GridModel;
	readonly model: RegionCompositionModel;
	readonly measurements: LayoutMeasurements;
	readonly cache?: RegionLocalLayoutCache | undefined;
}

function solveCellLeaf(
	input: GridRegionSolveInput,
	regionId: string,
	cellsById: ReadonlyMap<string, GridModel['cells'][number]>,
): readonly SolvedGridCell[] | undefined {
	const { graph, model, measurements, cache } = input;
	const region = defined(model.regionsById.get(regionId));
	const cell = defined(cellsById.get(regionId));
	const document = gridCellRegionLeafDocument(graph, model, regionId);
	const content = gridCellLeafContent(document);
	if (content.kind === GridCellLeafContentKind.Empty) return [{ cell, ...content.localLayout }];
	try {
		return [
			{
				cell,
				...solveRegionLeafLayout({
					document,
					measurements: localMeasurements(document, measurements),
					leafPolicy: regionLeafPolicy(region.definition),
					cache,
				}),
			},
		];
	} catch (error) {
		if (error instanceof InvalidRegionLeafGraphError) return undefined;
		throw error;
	}
}

/** Traverse the common region tree; each cell leaf owns its local graph and ranks. */
export function solveGridCellRegionLeaves(
	input: GridRegionSolveInput,
): readonly SolvedGridCell[] | undefined {
	const cellsById = new Map(input.grid.cells.map((cell) => [cell.id, cell]));
	function solveRegion(regionId: string): readonly SolvedGridCell[] | undefined {
		const region = defined(input.model.regionsById.get(regionId));
		if (region.childIds.length === 0) return solveCellLeaf(input, regionId, cellsById);
		const children: SolvedGridCell[] = [];
		for (const childId of region.childIds) {
			const solved = solveRegion(childId);
			if (solved === undefined) return undefined;
			children.push(...solved);
		}
		return children;
	}
	return solveRegion(input.model.rootId);
}

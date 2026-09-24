import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { SolvedGridCell } from './grid-cell-disposition';
import { type GridModel, localMeasurements } from './grid-cell-model';
import { gridCellRegionLeafDocument } from './grid-cell-region-model';
import type { LayoutMeasurements } from './layout-types';
import type { NestedRegionLocalLayoutCache } from './nested-region-local-cache';
import type { RegionCompositionModel } from './region-composition-model';
import { InvalidRegionLeafGraphError, solveRegionLeafLayout } from './region-leaf-layout';

interface GridRegionSolveInput {
	readonly graph: LogicGraph;
	readonly grid: GridModel;
	readonly model: RegionCompositionModel;
	readonly measurements: LayoutMeasurements;
	readonly cache?: NestedRegionLocalLayoutCache | undefined;
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
	try {
		return [
			{
				cell,
				...solveRegionLeafLayout(
					document,
					localMeasurements(document, measurements),
					region.definition.policy,
					cache,
				),
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

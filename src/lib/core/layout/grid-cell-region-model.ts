import { defined, type LogicDocument } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { GridModel } from './grid-cell-model';
import type { GridCellInput } from './grid-cell-types';
import {
	normalizeRegionCompositionModel,
	type RegionCompositionLimits,
	type RegionCompositionModel,
	type RegionCompositionModelBuild,
} from './region-composition-model';
import type { RegionInput, RegionInputDefinition } from './region-composition-types';

/** Adapt an already normalized two-by-two grid to the common region ownership model. */
export function normalizeGridCellRegionModel(
	graph: LogicGraph,
	input: GridCellInput,
	grid: GridModel,
	limits: RegionCompositionLimits = {},
): RegionCompositionModelBuild {
	const regions: RegionInputDefinition[] = [{ id: input.rootId, layoutOrder: '0' }];
	for (const cell of grid.cells) {
		const region: RegionInputDefinition = {
			id: cell.id,
			parentId: cell.parentId,
			layoutOrder: `${cell.row}${cell.column}`,
		};
		if (cell.layout === undefined) regions.push(region);
		else regions.push({ ...region, layout: cell.layout });
	}
	const composition: RegionInput = {
		regions,
		regionByEndpointId: input.cellByEndpointId,
	};
	return normalizeRegionCompositionModel(graph, composition, limits);
}

/** Build a cell leaf from the common tree's endpoint and LCA ownership partitions. */
export function gridCellRegionLeafDocument(
	graph: LogicGraph,
	model: RegionCompositionModel,
	regionId: string,
): LogicDocument {
	const document = graph.document;
	const region = defined(model.regionsById.get(regionId));
	return {
		persistenceFormat: document.persistenceFormat,
		id: document.id,
		title: document.title,
		layout: region.definition.layout ?? document.layout,
		natures: document.natures,
		nodes: document.nodes.filter(({ id }) => model.leafByEndpointId.get(id) === regionId),
		groups: document.groups.filter(({ id }) => model.leafByEndpointId.get(id) === regionId),
		junctions: [],
		relations: defined(model.localRelationsByOwner.get(regionId)),
	};
}

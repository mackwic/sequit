import { GRID_REGION_PRESENTATION_SCHEMA } from '../document/logic-document';
import {
	normalizeRegionPresentation,
	RegionPresentationStatus,
	ROOT_LAYOUT_REGION_ID,
} from '../document/region-presentation';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { solveGridCellLayout } from './grid-cell-layout';
import { type GridCellInput, GridCellLayoutStatus } from './grid-cell-types';
import { layoutWithDedicatedEngine } from './layout-engine';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from './layout-types';
import {
	type NestedRegionExecutionContext,
	solveNestedRegionLayout,
	solveNestedRegionLayoutForProjection,
} from './nested-region-layout';
import type { NestedRegionLocalLayoutCache } from './nested-region-local-cache';
import {
	type NestedRegionInput,
	type NestedRegionLayoutAttempt,
	NestedRegionLayoutStatus,
} from './nested-region-types';
import { SharedLaneLayoutStatus, solveSharedLaneLayout } from './shared-lane-layout';

export enum LayoutRegionKind {
	Root = 'root',
}

export enum LayoutRegionPolicy {
	Dedicated = 'dedicated',
	SharedLanes = 'shared-lanes',
	NestedRegions = 'nested-regions',
	GridCells = 'grid-cells',
}

export class UnsupportedLayoutPresentationError extends Error {
	constructor(
		readonly documentId: string,
		readonly reason = 'The shared lane layout policy does not support this document.',
	) {
		super(`Shared lane layout is unsupported for document ${documentId}: ${reason}`);
		this.name = 'UnsupportedLayoutPresentationError';
	}
}

export class UnknownLayoutPresentationError extends Error {
	constructor(
		readonly documentId: string,
		readonly reason: string,
	) {
		super(`Shared lane layout is unresolved for document ${documentId}: ${reason}`);
		this.name = 'UnknownLayoutPresentationError';
	}
}

export class UnsupportedNestedRegionLayoutError extends Error {
	constructor(
		readonly documentId: string,
		readonly reason: string,
	) {
		super(`Nested region layout is unsupported for document ${documentId}: ${reason}`);
		this.name = 'UnsupportedNestedRegionLayoutError';
	}
}

export class UnknownNestedRegionLayoutError extends Error {
	constructor(
		readonly documentId: string,
		readonly reason: string,
	) {
		super(`Nested region layout is unresolved for document ${documentId}: ${reason}`);
		this.name = 'UnknownNestedRegionLayoutError';
	}
}

export class UnsupportedGridCellLayoutError extends Error {
	constructor(
		readonly documentId: string,
		readonly reason: string,
	) {
		super(`Grid cell layout is unsupported for document ${documentId}: ${reason}`);
		this.name = 'UnsupportedGridCellLayoutError';
	}
}

export class UnknownGridCellLayoutError extends Error {
	constructor(
		readonly documentId: string,
		readonly reason: string,
	) {
		super(`Grid cell layout is unresolved for document ${documentId}: ${reason}`);
		this.name = 'UnknownGridCellLayoutError';
	}
}

/** The root covers the full source graph for either document policy. */
export interface RootLayoutRegion {
	readonly kind: LayoutRegionKind.Root;
	readonly documentId: string;
	readonly policy: LayoutRegionPolicy;
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
}

/** Keep the graph and ranks borrowed; a root needs no second graph representation. */
export function normalizeRootRegion(graph: LogicGraph, ranks: TopologicalRanks): RootLayoutRegion {
	let policy = LayoutRegionPolicy.Dedicated;
	if (graph.document.presentation !== undefined) policy = LayoutRegionPolicy.SharedLanes;
	if (graph.document.regionPresentation !== undefined) policy = LayoutRegionPolicy.NestedRegions;
	if (graph.document.regionPresentation?.grid !== undefined) policy = LayoutRegionPolicy.GridCells;
	return {
		kind: LayoutRegionKind.Root,
		documentId: graph.document.id,
		policy,
		graph,
		ranks,
	};
}

function gridCellInput(graph: LogicGraph): GridCellInput {
	const presentation = graph.document.regionPresentation;
	if (presentation?.schemaVersion !== GRID_REGION_PRESENTATION_SCHEMA)
		throw new UnsupportedGridCellLayoutError(graph.document.id, 'Missing grid presentation.');
	const assignments = new Map<string, string>();
	for (const endpoint of [
		...graph.document.groups,
		...graph.document.nodes,
		...graph.document.junctions,
	]) {
		if (endpoint.regionId !== undefined) assignments.set(endpoint.id, endpoint.regionId);
	}
	const normalized = normalizeRegionPresentation(graph.document, presentation.regions, assignments);
	if (normalized.status !== RegionPresentationStatus.Ready)
		throw new UnsupportedGridCellLayoutError(
			graph.document.id,
			'Invalid region hierarchy or ownership.',
		);
	if (normalized.value.regions.length !== 5)
		throw new UnsupportedGridCellLayoutError(
			graph.document.id,
			'A grid requires exactly four direct child regions.',
		);
	const regionsById = new Map(normalized.value.regions.map((region) => [region.id, region]));
	const cells = presentation.grid.cells.map(({ regionId, row, column }) => {
		const region = regionsById.get(regionId);
		return {
			id: regionId,
			parentId: region?.parentId ?? '',
			row,
			column,
		};
	});
	return {
		rootId: ROOT_LAYOUT_REGION_ID,
		cells,
		cellByEndpointId: normalized.value.regionByEndpointId,
		minimumColumnWidths: presentation.grid.minimumColumnWidths,
		minimumRowHeights: presentation.grid.minimumRowHeights,
	};
}

function layoutWithGridCells(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	cache?: NestedRegionLocalLayoutCache,
): LayoutResult {
	const attempt = solveGridCellLayout(graph, measurements, gridCellInput(graph), cache);
	if (attempt.status === GridCellLayoutStatus.Selected) return attempt.layout;
	if (attempt.status === GridCellLayoutStatus.Unsupported)
		throw new UnsupportedGridCellLayoutError(graph.document.id, attempt.reason);
	throw new UnknownGridCellLayoutError(graph.document.id, attempt.reason);
}

export function nestedRegionInput(graph: LogicGraph): NestedRegionInput {
	const definitions = graph.document.regionPresentation?.regions ?? [];
	const assignments = new Map<string, string>();
	for (const endpoint of [
		...graph.document.groups,
		...graph.document.nodes,
		...graph.document.junctions,
	]) {
		if (endpoint.regionId !== undefined) assignments.set(endpoint.id, endpoint.regionId);
	}
	const normalized = normalizeRegionPresentation(graph.document, definitions, assignments);
	if (normalized.status !== RegionPresentationStatus.Ready)
		throw new UnsupportedNestedRegionLayoutError(
			graph.document.id,
			'Invalid region hierarchy or ownership.',
		);
	const regions: NestedRegionInput['regions'][number][] = [
		{ id: ROOT_LAYOUT_REGION_ID, layoutOrder: 'a0' },
	];
	for (const region of normalized.value.regions) {
		if (region.id === ROOT_LAYOUT_REGION_ID) continue;
		if (region.parentId === undefined || region.layoutOrder === undefined)
			throw new UnsupportedNestedRegionLayoutError(
				graph.document.id,
				'Invalid normalized child region.',
			);
		let definition: NestedRegionInput['regions'][number] = {
			id: region.id,
			parentId: region.parentId,
			layoutOrder: region.layoutOrder,
			policy: region.policy,
		};
		if (region.lanePresentation !== undefined)
			definition = { ...definition, lanePresentation: region.lanePresentation };
		if (region.grid !== undefined) definition = { ...definition, grid: region.grid };
		regions.push(definition);
	}
	return { regions, regionByEndpointId: normalized.value.regionByEndpointId };
}

function layoutWithNestedRegions(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	execution: LayoutOptions | NestedRegionExecutionContext,
): LayoutResult {
	const input = nestedRegionInput(graph);
	let attempt: NestedRegionLayoutAttempt;
	if ('options' in execution && execution.cache !== undefined)
		attempt = solveNestedRegionLayoutForProjection(graph, measurements, input, execution.cache);
	else attempt = solveNestedRegionLayout(graph, measurements, input, layoutOptions(execution));
	if (attempt.status === NestedRegionLayoutStatus.Selected)
		return {
			...attempt.layout,
			regions: attempt.regions.map(({ id, bounds }) => ({ id, bounds })),
		};
	if (attempt.status === NestedRegionLayoutStatus.Unsupported)
		throw new UnsupportedNestedRegionLayoutError(graph.document.id, attempt.reason);
	throw new UnknownNestedRegionLayoutError(graph.document.id, attempt.reason);
}

function layoutOptions(execution: LayoutOptions | NestedRegionExecutionContext): LayoutOptions {
	if ('options' in execution) return execution.options;
	return execution;
}

function layoutCache(
	execution: LayoutOptions | NestedRegionExecutionContext,
): NestedRegionLocalLayoutCache | undefined {
	if ('options' in execution) return execution.cache;
	return undefined;
}

function layoutWithRootRegionExecution(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	execution: LayoutOptions | NestedRegionExecutionContext,
): LayoutResult {
	const options = layoutOptions(execution);
	const region = normalizeRootRegion(graph, ranks);
	if (region.policy === LayoutRegionPolicy.Dedicated)
		return layoutWithDedicatedEngine(region.graph, region.ranks, measurements, options);
	if (region.policy === LayoutRegionPolicy.NestedRegions)
		return layoutWithNestedRegions(region.graph, measurements, execution);
	if (region.policy === LayoutRegionPolicy.GridCells)
		return layoutWithGridCells(region.graph, measurements, layoutCache(execution));
	const attempt = solveSharedLaneLayout(region.graph, region.ranks, measurements, options);
	if (attempt.status === SharedLaneLayoutStatus.Selected) return attempt.layout;
	if (attempt.status === SharedLaneLayoutStatus.Unsupported)
		throw new UnsupportedLayoutPresentationError(region.documentId, attempt.reason);
	throw new UnknownLayoutPresentationError(region.documentId, attempt.reason);
}

/** Dispatch the root to its declared layout policy. */
export function layoutWithRootRegion(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: LayoutOptions = {},
): LayoutResult {
	return layoutWithRootRegionExecution(graph, ranks, measurements, options);
}

/** Projection-owned cache is passed separately from the public layout options. */
export function layoutWithRootRegionForProjection(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	cache: NestedRegionLocalLayoutCache,
): LayoutResult {
	return layoutWithRootRegionExecution(graph, ranks, measurements, {
		options: {},
		cache,
	});
}

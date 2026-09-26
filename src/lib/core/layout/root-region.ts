import { defined, type LayoutPolicy } from '../document/logic-document';
import {
	normalizeRegionPresentation,
	RegionPresentationStatus,
	ROOT_LAYOUT_REGION_ID,
} from '../document/region-presentation';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { RegionGeometryDiagnosticCode } from './geometry/region-geometry-diagnostic';
import { SharedLaneLayoutStatus, solveSharedLaneLayout } from './lanes/shared-lane-layout';
import { layoutWithDedicatedEngine } from './layout-engine';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from './layout-types';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutAttempt,
} from './regions/model/region-composition-types';
import type { RegionIncidentUnknownCode } from './regions/model/region-incident-contract';
import type { RegionLocalLayoutCache } from './regions/model/region-local-cache';
import {
	type RegionExecutionContext,
	solveNestedRegionLayout,
	solveNestedRegionLayoutForProjection,
} from './regions/recursive/nested-region-layout';

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

export class UnsupportedRegionLayoutError extends Error {
	constructor(
		readonly documentId: string,
		readonly reason: string,
	) {
		super(`Nested region layout is unsupported for document ${documentId}: ${reason}`);
		this.name = 'UnsupportedRegionLayoutError';
	}
}

export class UnknownRegionLayoutError extends Error {
	constructor(
		readonly documentId: string,
		readonly reason: string,
		readonly diagnostic?: Extract<RegionLayoutAttempt, { status: RegionCompositionStatus.Unknown }>,
	) {
		super(`Nested region layout is unresolved for document ${documentId}: ${reason}`);
		this.name = 'UnknownRegionLayoutError';
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
	readonly code: RegionGeometryDiagnosticCode | RegionIncidentUnknownCode | undefined;
	readonly regionId: string | undefined;
	readonly relationId: string | undefined;

	constructor(
		readonly documentId: string,
		readonly reason: string,
		diagnostic?: {
			readonly code?: RegionGeometryDiagnosticCode | RegionIncidentUnknownCode;
			readonly regionId?: string;
			readonly relationId?: string;
		},
	) {
		super(`Grid cell layout is unresolved for document ${documentId}: ${reason}`);
		this.name = 'UnknownGridCellLayoutError';
		this.code = diagnostic?.code;
		this.regionId = diagnostic?.regionId;
		this.relationId = diagnostic?.relationId;
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

export function nestedRegionInput(graph: LogicGraph): RegionInput {
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
		throw new UnsupportedRegionLayoutError(
			graph.document.id,
			'Invalid region hierarchy or ownership.',
		);
	const rootPolicy: LayoutPolicy = defined(
		normalized.value.regions.find(({ id }) => id === ROOT_LAYOUT_REGION_ID),
	).policy;
	let root: RegionInput['regions'][number] = {
		id: ROOT_LAYOUT_REGION_ID,
		layoutOrder: 'a0',
		policy: rootPolicy,
	};
	if (graph.document.regionPresentation?.grid !== undefined)
		root = { ...root, grid: graph.document.regionPresentation.grid };
	const regions: RegionInput['regions'][number][] = [root];
	for (const region of normalized.value.regions) {
		if (region.id === ROOT_LAYOUT_REGION_ID) continue;
		if (region.parentId === undefined || region.layoutOrder === undefined)
			throw new UnsupportedRegionLayoutError(graph.document.id, 'Invalid normalized child region.');
		let definition: RegionInput['regions'][number] = {
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
	execution: LayoutOptions | RegionExecutionContext,
	gridRoot = false,
): LayoutResult {
	let input: RegionInput;
	try {
		input = nestedRegionInput(graph);
	} catch (error) {
		if (gridRoot && error instanceof UnsupportedRegionLayoutError)
			throw new UnsupportedGridCellLayoutError(graph.document.id, error.reason);
		throw error;
	}
	let attempt: RegionLayoutAttempt;
	if ('options' in execution && execution.cache !== undefined)
		attempt = solveNestedRegionLayoutForProjection(graph, measurements, input, execution.cache);
	else attempt = solveNestedRegionLayout(graph, measurements, input, layoutOptions(execution));
	if (attempt.status === RegionCompositionStatus.Selected)
		return {
			...attempt.layout,
			regions: attempt.regions.map(({ id, bounds }) => ({ id, bounds })),
		};
	if (attempt.status === RegionCompositionStatus.Unsupported) {
		if (gridRoot) throw new UnsupportedGridCellLayoutError(graph.document.id, attempt.reason);
		throw new UnsupportedRegionLayoutError(graph.document.id, attempt.reason);
	}
	if (gridRoot) throw new UnknownGridCellLayoutError(graph.document.id, attempt.reason, attempt);
	throw new UnknownRegionLayoutError(graph.document.id, attempt.reason, attempt);
}

function layoutOptions(execution: LayoutOptions | RegionExecutionContext): LayoutOptions {
	if ('options' in execution) return execution.options;
	return execution;
}

function layoutWithRootRegionExecution(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	execution: LayoutOptions | RegionExecutionContext,
): LayoutResult {
	const options = layoutOptions(execution);
	const region = normalizeRootRegion(graph, ranks);
	if (region.policy === LayoutRegionPolicy.Dedicated)
		return layoutWithDedicatedEngine(region.graph, region.ranks, measurements, options);
	if (region.policy === LayoutRegionPolicy.NestedRegions)
		return layoutWithNestedRegions(region.graph, measurements, execution);
	if (region.policy === LayoutRegionPolicy.GridCells)
		return layoutWithNestedRegions(region.graph, measurements, execution, true);
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
	cache: RegionLocalLayoutCache,
): LayoutResult {
	return layoutWithRootRegionExecution(graph, ranks, measurements, {
		options: {},
		cache,
	});
}

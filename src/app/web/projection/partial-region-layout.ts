import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import { defined, type LogicDocument } from '../../../lib/core/document/logic-document';
import { createGraph, type LogicGraph } from '../../../lib/core/graph/create-graph';
import type { LayoutMeasurements } from '../../../lib/core/layout/layout-types';
import { solveNestedRegionLayoutForProjection } from '../../../lib/core/layout/nested-region-layout';
import { nestedRegionLocalMeasurements } from '../../../lib/core/layout/nested-region-local-measurements';
import {
	leafDocument,
	type RecursiveContext,
} from '../../../lib/core/layout/nested-region-recursive-model-adapter';
import {
	normalizeRegionCompositionModel,
	type RegionCompositionModel,
	RegionCompositionModelStatus,
	RegionRelationKind,
} from '../../../lib/core/layout/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
} from '../../../lib/core/layout/region-composition-types';
import {
	solveRegionLeafLayout,
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from '../../../lib/core/layout/region-leaf-layout';
import { regionLeafPolicy } from '../../../lib/core/layout/region-leaf-policy';
import type { RegionLocalLayoutCache } from '../../../lib/core/layout/region-local-cache';
import {
	nestedRegionInput,
	UnknownRegionLayoutError,
	UnsupportedRegionLayoutError,
} from '../../../lib/core/layout/root-region';
import {
	type CanvasModel,
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../ui/canvas/canvas-model';

export enum RegionPreviewFailureCode {
	Unknown = 'unknown-leaf-layout',
	Unsupported = 'unsupported-leaf-layout',
	CalculationFailed = 'leaf-calculation-failed',
}

export enum RegionPreviewKind {
	Ready = 'ready',
	Diagnostic = 'diagnostic',
}

export enum RegionPreviewScope {
	Leaf = 'leaf',
	ClosedSubtree = 'closed-subtree',
}

interface ReadyRegionPreview {
	readonly kind: RegionPreviewKind.Ready;
	readonly regionId: string;
	readonly scope: RegionPreviewScope;
	readonly canvas: CanvasModel;
}

interface FailedRegionPreview {
	readonly kind: RegionPreviewKind.Diagnostic;
	readonly regionId: string;
	readonly code: RegionPreviewFailureCode;
	readonly message: string;
	readonly endpointIds: readonly string[];
	readonly relationIds: readonly string[];
}

export type RegionPreview = ReadyRegionPreview | FailedRegionPreview;

export class PartialRegionLayoutError extends Error {
	constructor(
		readonly originalCause: unknown,
		readonly regions: readonly RegionPreview[],
	) {
		let message = String(originalCause);
		if (originalCause instanceof Error) message = originalCause.message;
		super(message, {
			cause: originalCause,
		});
		this.name = 'PartialRegionLayoutError';
	}
}

interface LocalFailure {
	readonly code: RegionPreviewFailureCode;
	readonly message: string;
}

function localFailure(error: unknown): LocalFailure {
	if (error instanceof UnknownRegionLeafLayoutError)
		return {
			code: RegionPreviewFailureCode.Unknown,
			message: 'La géométrie locale de cette région reste sans solution validée.',
		};
	if (error instanceof UnsupportedRegionLeafLayoutError)
		return {
			code: RegionPreviewFailureCode.Unsupported,
			message: 'La disposition locale de cette région n’est pas encore prise en charge.',
		};
	return {
		code: RegionPreviewFailureCode.CalculationFailed,
		message: 'Le calcul local de cette région a échoué.',
	};
}

function previewLeaf(context: RecursiveContext, regionId: string): RegionPreview {
	const document = leafDocument(context, regionId);
	const measurements = nestedRegionLocalMeasurements(document, context.measurements);
	const policy = regionLeafPolicy(defined(context.model.regionsById.get(regionId)).definition);
	try {
		const solved = solveRegionLeafLayout({
			document,
			measurements,
			leafPolicy: policy,
			cache: context.cache,
		});
		return {
			kind: RegionPreviewKind.Ready,
			regionId,
			scope: RegionPreviewScope.Leaf,
			canvas: createCanvasModel(createCanvasMeasurementModel(document), solved.layout, {
				document,
				ranks: solved.ranks,
			}),
		};
	} catch (error) {
		return {
			kind: RegionPreviewKind.Diagnostic,
			regionId,
			...localFailure(error),
			endpointIds: [...document.nodes, ...document.groups, ...document.junctions]
				.map(({ id }) => id)
				.sort(compareCanonicalStrings),
			relationIds: document.relations.map(({ id }) => id).sort(compareCanonicalStrings),
		};
	}
}

function subtreeRegionIds(model: RegionCompositionModel, rootId: string): ReadonlySet<string> {
	const ids = new Set<string>([rootId]);
	for (const regionId of model.preorderIds) {
		const parentId = model.regionsById.get(regionId)?.parentId;
		if (parentId !== undefined && ids.has(parentId)) ids.add(regionId);
	}
	return ids;
}

function subtreeEndpointIds(
	model: RegionCompositionModel,
	regionIds: ReadonlySet<string>,
): ReadonlySet<string> {
	const endpointIds = new Set<string>();
	for (const [endpointId, leafId] of model.leafByEndpointId)
		if (regionIds.has(leafId)) endpointIds.add(endpointId);
	return endpointIds;
}

function closedSubtree(model: RegionCompositionModel, endpointIds: ReadonlySet<string>): boolean {
	return model.relations.every(({ relation }) => {
		const sourceInside = endpointIds.has(relation.from);
		const targetInside = endpointIds.has(relation.to);
		return sourceInside === targetInside;
	});
}

function subtreeDocument(graph: LogicGraph, endpointIds: ReadonlySet<string>): LogicDocument {
	const source = graph.document;
	return {
		persistenceFormat: source.persistenceFormat,
		id: source.id,
		title: source.title,
		layout: source.layout,
		natures: source.natures,
		nodes: source.nodes.filter(({ id }) => endpointIds.has(id)),
		groups: source.groups.filter(({ id }) => endpointIds.has(id)),
		junctions: source.junctions.filter(({ id }) => endpointIds.has(id)),
		relations: source.relations.filter(
			({ from, to }) => endpointIds.has(from) && endpointIds.has(to),
		),
	};
}

function subtreeInput(
	model: RegionCompositionModel,
	rootId: string,
	regionIds: ReadonlySet<string>,
	endpointIds: ReadonlySet<string>,
): RegionInput {
	const regions = model.preorderIds.flatMap((regionId) => {
		if (!regionIds.has(regionId)) return [];
		const definition = defined(model.regionsById.get(regionId)).definition;
		if (regionId !== rootId) return [definition];
		const root = { ...definition };
		Reflect.deleteProperty(root, 'parentId');
		return [root];
	});
	const regionByEndpointId = new Map(
		[...model.leafByEndpointId].filter(([endpointId]) => endpointIds.has(endpointId)),
	);
	return { regions, regionByEndpointId };
}

/** A closed subtree owns every route and portal within its independent local canvas. */
function previewClosedSubtree(
	context: RecursiveContext,
	regionId: string,
	regionIds: ReadonlySet<string>,
	endpointIds: ReadonlySet<string>,
): RegionPreview | undefined {
	try {
		const document = subtreeDocument(context.graph, endpointIds);
		const graph = createGraph(document);
		if (!graph.ok) return undefined;
		const measurements = nestedRegionLocalMeasurements(document, context.measurements);
		const attempt = solveNestedRegionLayoutForProjection(
			graph.value,
			measurements,
			subtreeInput(context.model, regionId, regionIds, endpointIds),
			defined(context.cache),
		);
		if (attempt.status !== RegionCompositionStatus.Selected) return undefined;
		const layout = {
			...attempt.layout,
			regions: attempt.regions.map(({ id, bounds }) => ({ id, bounds })),
		};
		return {
			kind: RegionPreviewKind.Ready,
			regionId,
			scope: RegionPreviewScope.ClosedSubtree,
			canvas: createCanvasModel(createCanvasMeasurementModel(document), layout),
		};
	} catch {
		// A failed branch cannot prevent independent siblings from publishing their current previews.
		return undefined;
	}
}

/** Publish only complete independent canvases from the current source. */
export function partialRegionPreviews(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	cache: RegionLocalLayoutCache,
): readonly RegionPreview[] {
	const normalized = normalizeRegionCompositionModel(graph, nestedRegionInput(graph));
	if (normalized.status !== RegionCompositionModelStatus.Ready) return [];
	const model = normalized.model;
	const incidentLeafIds = new Set<string>();
	for (const owned of model.relations) {
		if (owned.kind !== RegionRelationKind.Crossing) continue;
		incidentLeafIds.add(owned.sourceLeafId);
		incidentLeafIds.add(owned.targetLeafId);
	}
	const context: RecursiveContext = {
		graph,
		model,
		measurements,
		cache,
		ownershipByRelationId: new Map(model.relations.map((owned) => [owned.relation.id, owned])),
	};
	const coveredRegionIds = new Set<string>();
	return model.preorderIds.flatMap((regionId) => {
		if (coveredRegionIds.has(regionId)) return [];
		const region = defined(model.regionsById.get(regionId));
		if (region.childIds.length === 0) {
			if (incidentLeafIds.has(regionId)) return [];
			return [previewLeaf(context, regionId)];
		}
		if (regionId === model.rootId) return [];
		const regionIds = subtreeRegionIds(model, regionId);
		const endpointIds = subtreeEndpointIds(model, regionIds);
		if (!closedSubtree(model, endpointIds)) return [];
		const preview = previewClosedSubtree(context, regionId, regionIds, endpointIds);
		if (preview === undefined) return [];
		regionIds.forEach((id) => coveredRegionIds.add(id));
		return [preview];
	});
}

function isNestedRegionFailure(error: unknown): boolean {
	if (error instanceof UnknownRegionLayoutError) return true;
	return error instanceof UnsupportedRegionLayoutError;
}

export function partialRegionFailure(
	error: unknown,
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	cache: RegionLocalLayoutCache,
): unknown {
	if (!isNestedRegionFailure(error)) return error;
	try {
		const regions = partialRegionPreviews(graph, measurements, cache);
		if (regions.length > 0) return new PartialRegionLayoutError(error, regions);
	} catch {
		// An inspection failure must not replace the original layout diagnostic.
	}
	return error;
}

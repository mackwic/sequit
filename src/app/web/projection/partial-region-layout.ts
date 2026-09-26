import type { LogicGraph } from '../../../lib/core/graph/create-graph';
import type { LayoutMeasurements } from '../../../lib/core/layout/layout-types';
import { RegionCompositionStatus } from '../../../lib/core/layout/regions/model/region-composition-types';
import type { RegionLocalLayoutCache } from '../../../lib/core/layout/regions/model/region-local-cache';
import {
	type RegionSubtreeAttempt,
	type RegionSubtreeFailure,
	RegionSubtreeScope,
	solveRegionSubtreeAttempts,
} from '../../../lib/core/layout/regions/recursive/region-partial-composition';
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

export { RegionSubtreeScope as RegionPreviewScope };

export enum RegionPreviewFailureCode {
	Unknown = 'unknown-leaf-layout',
	Unsupported = 'unsupported-leaf-layout',
	CalculationFailed = 'leaf-calculation-failed',
}

export enum RegionPreviewKind {
	Ready = 'ready',
	Diagnostic = 'diagnostic',
}

interface ReadyRegionPreview {
	readonly kind: RegionPreviewKind.Ready;
	readonly regionId: string;
	readonly scope: RegionSubtreeScope;
	readonly canvas: CanvasModel;
}

interface FailedRegionPreview {
	readonly kind: RegionPreviewKind.Diagnostic;
	readonly regionId: string;
	readonly code: RegionPreviewFailureCode;
	readonly message: string;
	readonly failure: RegionSubtreeFailure;
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
		super(message, { cause: originalCause });
		this.name = 'PartialRegionLayoutError';
	}
}

function readyPreview(
	attempt: Extract<RegionSubtreeAttempt, { status: RegionCompositionStatus.Selected }>,
): ReadyRegionPreview {
	const measurementModel = createCanvasMeasurementModel(attempt.document);
	let canvas: CanvasModel;
	if (attempt.scope === RegionSubtreeScope.Leaf)
		canvas = createCanvasModel(measurementModel, attempt.layout, {
			document: attempt.document,
			ranks: attempt.ranks,
		});
	else canvas = createCanvasModel(measurementModel, attempt.layout);
	return {
		kind: RegionPreviewKind.Ready,
		regionId: attempt.regionId,
		scope: attempt.scope,
		canvas,
	};
}

function diagnosticPreview(attempt: RegionSubtreeFailure): FailedRegionPreview {
	let code = RegionPreviewFailureCode.CalculationFailed;
	let message = 'Le calcul local de cette région a échoué.';
	if (attempt.status === RegionCompositionStatus.Unknown) {
		code = RegionPreviewFailureCode.Unknown;
		message = 'La géométrie locale de cette région reste sans solution validée.';
	}
	if (attempt.status === RegionCompositionStatus.Unsupported) {
		code = RegionPreviewFailureCode.Unsupported;
		message = 'La disposition locale de cette région n’est pas encore prise en charge.';
	}
	return {
		kind: RegionPreviewKind.Diagnostic,
		regionId: attempt.regionId,
		code,
		message,
		failure: attempt,
		endpointIds: attempt.endpointIds,
		relationIds: attempt.relationIds,
	};
}

/** Project complete current-source subtree attempts into canvas models. */
export function partialRegionPreviews(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	cache: RegionLocalLayoutCache,
): readonly RegionPreview[] {
	const attempts = solveRegionSubtreeAttempts({
		graph,
		measurements,
		input: nestedRegionInput(graph),
		cache,
	});
	const previews: RegionPreview[] = [];
	for (const attempt of attempts) {
		if (attempt.status === RegionCompositionStatus.Selected) {
			previews.push(readyPreview(attempt));
			continue;
		}
		if (attempt.scope === RegionSubtreeScope.Leaf) previews.push(diagnosticPreview(attempt));
	}
	return previews;
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

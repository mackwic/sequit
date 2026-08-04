import { performance } from 'node:perf_hooks';

import { createCanvasMeasurementModel } from '../../src/lib/canvas/canvas-model';
import type { LogicDocument } from '../../src/lib/document/logic-document';
import { validateLogicDocument } from '../../src/lib/document/validate-logic-document';
import { createGraph } from '../../src/lib/graph/create-graph';
import { topologicallyRank } from '../../src/lib/graph/topological-ranks';
import { layoutGraph } from '../../src/lib/layout/layout-graph';
import { layoutMeasurementsFor } from '../builders/layout-measurements';
import { applyLayoutPerformanceInsertion } from '../scenarios/layout-performance/apply-layout-performance-insertion';
import type { LayoutPerformanceInsertion } from '../scenarios/layout-performance/scenario-types';

export interface IncrementalLayoutTiming {
	readonly documentUpdateMs: number;
	readonly validationMs: number;
	readonly graphCreationMs: number;
	readonly rankingMs: number;
	readonly measurementProjectionMs: number;
	readonly syntheticMeasurementsMs: number;
	readonly synchronousProjectionMs: number;
	readonly layoutMs: number;
	readonly totalMs: number;
}

export interface TimedLayoutPerformanceInsertion {
	readonly nodeIndex: number;
	readonly document: LogicDocument;
	readonly timing: IncrementalLayoutTiming;
}

export async function timeLayoutPerformanceInsertion(
	document: LogicDocument,
	insertion: LayoutPerformanceInsertion,
): Promise<TimedLayoutPerformanceInsertion> {
	const totalStart = performance.now();
	const updatedDocument = applyLayoutPerformanceInsertion(document, insertion);
	const documentUpdatedAt = performance.now();

	const validation = validateLogicDocument(updatedDocument);
	const validationCompletedAt = performance.now();
	if (!validation.ok)
		throw new Error(`Incremental validation failed at node ${insertion.nodeIndex}`);

	const graphResult = createGraph(validation.value);
	const graphCreatedAt = performance.now();
	if (!graphResult.ok)
		throw new Error(`Incremental graph creation failed at node ${insertion.nodeIndex}`);

	const ranks = topologicallyRank(graphResult.value);
	const rankingCompletedAt = performance.now();
	createCanvasMeasurementModel(validation.value);
	const measurementProjectionCompletedAt = performance.now();

	const measurements = layoutMeasurementsFor(validation.value);
	const syntheticMeasurementsCompletedAt = performance.now();
	await layoutGraph(graphResult.value, ranks, measurements);
	const layoutCompletedAt = performance.now();

	return {
		nodeIndex: insertion.nodeIndex,
		document: updatedDocument,
		timing: {
			documentUpdateMs: documentUpdatedAt - totalStart,
			validationMs: validationCompletedAt - documentUpdatedAt,
			graphCreationMs: graphCreatedAt - validationCompletedAt,
			rankingMs: rankingCompletedAt - graphCreatedAt,
			measurementProjectionMs: measurementProjectionCompletedAt - rankingCompletedAt,
			syntheticMeasurementsMs: syntheticMeasurementsCompletedAt - measurementProjectionCompletedAt,
			synchronousProjectionMs: measurementProjectionCompletedAt - documentUpdatedAt,
			layoutMs: layoutCompletedAt - syntheticMeasurementsCompletedAt,
			totalMs: layoutCompletedAt - totalStart,
		},
	};
}

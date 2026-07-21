import * as Y from 'yjs';

import {
	type CanvasMeasurementModel,
	type CanvasModel,
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../canvas/canvas-model';
import { importLogicDocument, readLogicDocument } from '../collaboration/yjs-live-document';
import { createGraph } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import { layoutGraph, type LayoutMeasurements } from '../layout/layout-graph';
import { parseSequitToml } from '../text/parse-sequit-toml';

export interface OpenDocumentDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly line?: number;
	readonly column?: number;
}

export interface OpenedDocument {
	readonly measurementModel: CanvasMeasurementModel;
	createCanvasModel(measurements: LayoutMeasurements): Promise<CanvasModel>;
}

export type OpenDocumentResult =
	| { readonly ok: true; readonly value: OpenedDocument }
	| { readonly ok: false; readonly diagnostics: readonly OpenDocumentDiagnostic[] };

export function openDocument(source: string): OpenDocumentResult {
	const parsed = parseSequitToml(source);
	if (!parsed.ok) return parsed;

	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, parsed.value);
	const current = readLogicDocument(ydoc);
	if (!current.ok) return current;

	const graph = createGraph(current.value);
	if (!graph.ok) return graph;
	const ranks = topologicallyRank(graph.value);
	const measurementModel = createCanvasMeasurementModel(current.value);
	return {
		ok: true,
		value: {
			measurementModel,
			async createCanvasModel(measurements) {
				const layout = await layoutGraph(graph.value, ranks, measurements);
				return createCanvasModel(measurementModel, layout);
			},
		},
	};
}

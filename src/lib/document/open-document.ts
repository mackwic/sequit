import {
	type CanvasMeasurementModel,
	type CanvasModel,
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../canvas/canvas-model';
import { createGraph } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import { layoutGraph, type LayoutMeasurements } from '../layout/layout-graph';
import { parseSequitToml } from '../text/parse-sequit-toml';
import { createDocumentSession, type DocumentSession } from './document-session';

interface OpenDocumentDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly line?: number;
	readonly column?: number;
}

interface OpenDocumentProjection {
	readonly measurementModel: CanvasMeasurementModel;
	createCanvasModel(measurements: LayoutMeasurements): Promise<CanvasModel>;
}

interface OpenDocumentProjectionSuccess {
	readonly ok: true;
	readonly value: OpenDocumentProjection;
}
interface OpenDocumentFailure {
	readonly ok: false;
	readonly diagnostics: readonly OpenDocumentDiagnostic[];
}
export type OpenDocumentProjectionResult = OpenDocumentProjectionSuccess | OpenDocumentFailure;

export interface OpenedDocument {
	read(): OpenDocumentProjectionResult;
	subscribe(listener: () => void): () => void;
	replaceNodeMarkdown(nodeId: string, markdown: string): boolean;
	close(): void;
}

interface OpenDocumentSuccess {
	readonly ok: true;
	readonly value: OpenedDocument;
}
export type OpenDocumentResult = OpenDocumentSuccess | OpenDocumentFailure;

function projectDocument(session: DocumentSession): OpenDocumentProjectionResult {
	const current = session.read();
	/* istanbul ignore if -- @preserve: a validated import cannot become unreadable through this closed port. */
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

export function openDocument(source: string): OpenDocumentResult {
	const parsed = parseSequitToml(source);
	if (!parsed.ok) return parsed;

	const session = createDocumentSession(parsed.value);
	let current = projectDocument(session);
	if (!current.ok) {
		session.destroy();
		return current;
	}

	const listeners = new Set<() => void>();
	let closed = false;
	const unsubscribeSession = session.subscribe(() => {
		current = projectDocument(session);
		for (const listener of listeners) listener();
	});

	return {
		ok: true,
		value: {
			read: () => current,
			subscribe(listener) {
				if (closed) return () => undefined;
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			replaceNodeMarkdown: (nodeId, markdown) => session.replaceNodeMarkdown(nodeId, markdown),
			close() {
				if (closed) return;
				closed = true;
				unsubscribeSession();
				listeners.clear();
				session.destroy();
			},
		},
	};
}

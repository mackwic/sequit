import type {
	LogicDocument,
	LogicRelation,
	NewLogicNode,
} from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import type { DocumentCommandOutcome } from '../../../lib/infrastructure/document/document-command-contracts';
import { parseSequitToml } from '../../../lib/infrastructure/toml/parse-sequit-toml';
import type { DocumentSession } from '../document/document-session';
import { createDocumentSession } from '../document/yjs-document-session';
import {
	type CanvasMeasurementModel,
	type CanvasModel,
	createCanvasMeasurementModel,
	createCanvasModel as projectCanvasModel,
} from '../ui/canvas/canvas-model';
import type { CanvasProjection } from './canvas-projection';
import { layoutGraph, type LayoutMeasurements } from './layout-graph';

interface OpenDocumentDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly line?: number;
	readonly column?: number;
}

interface DocumentProjection {
	readonly document: LogicDocument;
	readonly graph: Extract<ReturnType<typeof createGraph>, { readonly ok: true }>['value'];
	readonly ranks: ReturnType<typeof topologicallyRank>;
	readonly measurementModel: CanvasMeasurementModel;
}

class OpenedDocument implements CanvasProjection {
	#projection: DocumentProjection;
	readonly #unsubscribe: () => void;
	readonly #subscribers = new Set<() => void>();
	#destroyed = false;

	constructor(
		private readonly session: DocumentSession,
		projection: DocumentProjection,
	) {
		this.#projection = projection;
		this.#unsubscribe = this.session.subscribe((document) => {
			this.#projection = projectDocument(document);
			for (const subscriber of [...this.#subscribers]) {
				try {
					subscriber();
				} catch {
					// Projection publication must reach every opened-document subscriber.
				}
			}
		});
	}

	get measurementModel(): CanvasMeasurementModel {
		return this.#projection.measurementModel;
	}

	async createCanvasModel(measurements: LayoutMeasurements): Promise<CanvasModel> {
		const currentProjection = this.#projection;
		const layout = await layoutGraph(
			currentProjection.graph,
			currentProjection.ranks,
			measurements,
		);
		return projectCanvasModel(currentProjection.measurementModel, layout, {
			document: currentProjection.document,
			ranks: currentProjection.ranks,
		});
	}

	addNode(node: NewLogicNode): Promise<LogicDocument> {
		return this.session.addNode(node);
	}

	addRelation(relation: LogicRelation): Promise<LogicDocument> {
		return this.session.addRelation(relation);
	}

	replaceNodeMarkdown(nodeId: string, markdown: string): Promise<DocumentCommandOutcome> {
		return this.session.replaceNodeMarkdown(nodeId, markdown);
	}

	subscribe(subscriber: () => void): () => void {
		if (this.#destroyed) return () => undefined;
		this.#subscribers.add(subscriber);
		return () => this.#subscribers.delete(subscriber);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#unsubscribe();
		this.#subscribers.clear();
		this.session.destroy();
	}
}

interface OpenDocumentSuccess {
	readonly ok: true;
	readonly value: OpenedDocument;
}

interface OpenDocumentFailure {
	readonly ok: false;
	readonly diagnostics: readonly OpenDocumentDiagnostic[];
}

export type OpenDocumentResult = OpenDocumentSuccess | OpenDocumentFailure;

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function projectDocument(document: LogicDocument): DocumentProjection {
	const nextGraph = createGraph(document);
	if (!nextGraph.ok) {
		throw new Error(nextGraph.diagnostics.map(({ message }) => message).join('; '));
	}
	return {
		document,
		graph: nextGraph.value,
		ranks: topologicallyRank(nextGraph.value),
		measurementModel: createCanvasMeasurementModel(document),
	};
}

function projectionFromGraph(
	document: LogicDocument,
	graph: DocumentProjection['graph'],
): DocumentProjection {
	return {
		document,
		graph,
		ranks: topologicallyRank(graph),
		measurementModel: createCanvasMeasurementModel(document),
	};
}

export function openDocument(
	source: string,
	createSession: (document: LogicDocument) => DocumentSession = createDocumentSession,
): OpenDocumentResult {
	const parsed = parseSequitToml(source);
	if (!parsed.ok) return parsed;

	const graph = createGraph(parsed.value);
	if (!graph.ok) return graph;
	const projection = projectionFromGraph(parsed.value, graph.value);
	let session: DocumentSession | undefined;

	try {
		session = createSession(parsed.value);
		return {
			ok: true,
			value: new OpenedDocument(session, projection),
		};
	} catch (error) {
		const diagnostics: OpenDocumentDiagnostic[] = [
			{
				code: 'open-document-failed',
				message: errorMessage(error),
				path: [],
			},
		];
		try {
			session?.destroy();
		} catch (cleanupError) {
			diagnostics.push({
				code: 'open-document-cleanup-failed',
				message: errorMessage(cleanupError),
				path: [],
			});
		}
		return {
			ok: false,
			diagnostics,
		};
	}
}

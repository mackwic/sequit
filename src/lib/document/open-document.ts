import {
	type CanvasMeasurementModel,
	type CanvasModel,
	createCanvasMeasurementModel,
	createCanvasModel as projectCanvasModel,
} from '../canvas/canvas-model';
import { createDocumentSession } from '../collaboration/yjs-document-session';
import { createGraph } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import { layoutGraph, type LayoutMeasurements } from '../layout/layout-graph';
import { parseSequitToml } from '../text/parse-sequit-toml';
import type { DocumentSession } from './document-session';
import type { LogicDocument, LogicRelation, NewLogicNode } from './logic-document';

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

class OpenedDocument {
	#projection: DocumentProjection;
	readonly #unsubscribe: () => void;

	constructor(
		private readonly session: DocumentSession,
		projection: DocumentProjection,
	) {
		this.#projection = projection;
		this.#unsubscribe = this.session.subscribe((document) => {
			this.#projection = projectDocument(document);
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
		return projectCanvasModel(currentProjection.measurementModel, layout);
	}

	addNode(node: NewLogicNode): Promise<LogicDocument> {
		return this.session.addNode(node);
	}

	addRelation(relation: LogicRelation): Promise<LogicDocument> {
		return this.session.addRelation(relation);
	}

	destroy(): void {
		this.#unsubscribe();
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

import type {
	LogicDocument,
	LogicGroup,
	LogicRelation,
	NewLogicNode,
} from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { SourceDocumentStateKind } from '../../../lib/infrastructure/collaboration/source-document-state';
import type { DocumentCommandOutcome } from '../../../lib/infrastructure/document/document-command-contracts';
import { parseSequitToml } from '../../../lib/infrastructure/toml/parse-sequit-toml';
import type { DocumentSession } from '../document/document-session';
import { createDocumentSession } from '../document/yjs-document-session';
import type { CanvasMeasurementModel, CanvasModel } from '../ui/canvas/canvas-model';
import type { CanvasProjection } from './canvas-projection';
import { DocumentProjection } from './document-projection';
import { LayoutProjectionError } from './layout-diagnostic';
import type { LayoutMeasurements } from './layout-graph';
import { SourceDocumentProjectionError } from './source-document-diagnostic';

interface OpenDocumentDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly line?: number;
	readonly column?: number;
}

class OpenedDocument implements CanvasProjection {
	readonly #projection: DocumentProjection;
	readonly #unsubscribe: () => void;
	readonly #unsubscribeSource: () => void;
	readonly #subscribers = new Set<() => void>();
	#destroyed = false;

	constructor(
		private readonly session: DocumentSession,
		projection: DocumentProjection,
	) {
		this.#projection = projection;
		this.#unsubscribe = this.session.subscribe((document) => {
			this.#projection.update(document);
			this.#notify();
		});
		this.#unsubscribeSource = this.session.subscribeSourceState((state) => {
			if (state.kind === SourceDocumentStateKind.Invalid) this.#notify();
		});
	}

	#notify(): void {
		for (const subscriber of [...this.#subscribers]) {
			try {
				subscriber();
			} catch {
				// Projection publication must reach every opened-document subscriber.
			}
		}
	}

	get measurementModel(): CanvasMeasurementModel {
		return this.#projection.measurementModel;
	}

	async createCanvasModel(measurements: LayoutMeasurements): Promise<CanvasModel> {
		const source = this.session.readSourceState();
		if (source?.kind === SourceDocumentStateKind.Invalid)
			throw new SourceDocumentProjectionError(source);
		const document = this.session.read();
		let canvas: CanvasModel;
		try {
			canvas = await this.#projection.createCanvasModel(measurements);
		} catch (cause) {
			const current = this.session.readSourceState();
			if (current?.kind === SourceDocumentStateKind.Invalid)
				throw new SourceDocumentProjectionError(current);
			throw new LayoutProjectionError(document, cause);
		}
		const current = this.session.readSourceState();
		if (current?.kind === SourceDocumentStateKind.Invalid)
			throw new SourceDocumentProjectionError(current);
		return canvas;
	}

	read(): LogicDocument {
		return this.session.read();
	}

	deleteElements(
		endpointIds: readonly string[],
		relationIds: readonly string[],
	): Promise<LogicDocument> {
		return this.session.deleteElements(endpointIds, relationIds);
	}

	addNode(node: NewLogicNode): Promise<LogicDocument> {
		return this.session.addNode(node);
	}

	addConnectedNode(
		node: NewLogicNode,
		relations: readonly LogicRelation[],
	): Promise<LogicDocument> {
		return this.session.addConnectedNode(node, relations);
	}

	addRelation(relation: LogicRelation): Promise<LogicDocument> {
		return this.session.addRelation(relation);
	}

	groupNodes(
		group: { readonly id: string; readonly label: string },
		nodeIds: readonly string[],
	): Promise<LogicDocument> {
		return this.session.groupNodes(group, nodeIds);
	}

	updateGroup(group: LogicGroup): Promise<LogicDocument> {
		return this.session.updateGroup(group);
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
		this.#unsubscribeSource();
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

export function openDocument(
	source: string,
	createSession: (document: LogicDocument) => DocumentSession = createDocumentSession,
): OpenDocumentResult {
	const parsed = parseSequitToml(source);
	if (!parsed.ok) return parsed;

	const graph = createGraph(parsed.value);
	if (!graph.ok) return graph;
	const projection = new DocumentProjection(parsed.value, graph.value);
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

export { createSharedCanvasProjection } from './shared-canvas-projection';

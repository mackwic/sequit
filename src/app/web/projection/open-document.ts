import type { LogicDocument } from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import type { DocumentSession } from '../../../lib/infrastructure/collaboration/collaborative-document-session-types';
import { SourceDocumentStateKind } from '../../../lib/infrastructure/collaboration/source-document-state';
import {
	type DocumentCommandOutcome,
	sessionClosedOutcome,
} from '../../../lib/infrastructure/document/document-command-contracts';
import type { NodeFields } from '../../../lib/infrastructure/document/node-fields';
import { parseSequitToml } from '../../../lib/infrastructure/toml/parse-sequit-toml';
import { createLocalDocumentSession } from '../document/local-document-session';
import type { CanvasMeasurementModel, CanvasModel } from '../ui/canvas/canvas-model';
import type { CanvasDocumentCommandPort } from '../ui/session/canvas-edit-activity';
import { createNodeEditPort } from '../ui/session/node-edit-port';
import type { CanvasProjection } from './canvas-projection';
import type { LayoutMeasurements } from './layout-graph';
import {
	createSharedCanvasProjection,
	type SharedCanvasProjection,
} from './shared-canvas-projection';

interface OpenDocumentDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly line?: number;
	readonly column?: number;
}

class OpenedDocument implements CanvasProjection {
	readonly #projection: SharedCanvasProjection;
	readonly #editPort: CanvasDocumentCommandPort;
	readonly #unsubscribe: () => void;
	readonly #unsubscribeSource: () => void;
	readonly #subscribers = new Set<() => void>();
	#destroyed = false;

	constructor(
		readonly session: DocumentSession,
		projection: SharedCanvasProjection,
	) {
		this.#projection = projection;
		this.#editPort = createNodeEditPort(session);
		this.#unsubscribe = this.session.subscribe((document) => {
			this.#projection.update(document);
			this.#notify();
		});
		this.#unsubscribeSource = this.session.subscribeToSourceState((state) => {
			this.#projection.updateSourceState(state);
			if (state.kind === SourceDocumentStateKind.Invalid) this.#notify();
		});
		this.#projection.updateSourceState(session.readSourceState());
	}

	/** Subscribers hear every document change, not only projection changes: titles are documents too. */
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

	/** Closed groups are folded here; `read()` stays the complete source document. */
	createCanvasModel(measurements: LayoutMeasurements): Promise<CanvasModel> {
		return this.#projection.createCanvasModel(measurements);
	}

	read(): LogicDocument {
		return this.session.read();
	}

	/** The canvas edit port over the local session. */
	readNode(nodeId: string): NodeFields | undefined {
		if (this.#destroyed) return undefined;
		return this.#editPort.readNode(nodeId);
	}

	saveNode(nodeId: string, base: NodeFields, draft: NodeFields): Promise<DocumentCommandOutcome> {
		if (this.#destroyed) return Promise.resolve(sessionClosedOutcome());
		return this.#editPort.saveNode(nodeId, base, draft);
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
	createSession: (document: LogicDocument) => DocumentSession = createLocalDocumentSession,
): OpenDocumentResult {
	const parsed = parseSequitToml(source);
	if (!parsed.ok) return parsed;

	const graph = createGraph(parsed.value);
	if (!graph.ok) return graph;
	const projection = createSharedCanvasProjection(parsed.value);
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

export { createSharedCanvasProjection };

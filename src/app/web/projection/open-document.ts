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
import type { CanvasDrafts } from './node-draft';
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
	readonly #documentSubscribers = new Set<() => void>();
	#destroyed = false;

	constructor(
		readonly session: DocumentSession,
		projection: SharedCanvasProjection,
	) {
		this.#projection = projection;
		this.#editPort = createNodeEditPort(session);
		this.#unsubscribe = this.session.subscribe((document) => {
			this.#projection.update(document);
			notify(this.#documentSubscribers);
			notify(this.#subscribers);
		});
		this.#unsubscribeSource = this.session.subscribeToSourceState((state) => {
			this.#projection.updateSourceState(state);
			if (state.kind === SourceDocumentStateKind.Invalid) notify(this.#subscribers);
		});
		this.#projection.updateSourceState(session.readSourceState());
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

	/** The canvas hears every document change, not only projection changes, and every draft. */
	subscribe(subscriber: () => void): () => void {
		if (this.#destroyed) return () => undefined;
		this.#subscribers.add(subscriber);
		return () => this.#subscribers.delete(subscriber);
	}

	/** Every change of the document itself, titles included; drafts are not changes. */
	subscribeToDocument(subscriber: () => void): () => void {
		if (this.#destroyed) return () => undefined;
		this.#documentSubscribers.add(subscriber);
		return () => this.#documentSubscribers.delete(subscriber);
	}

	/** Shows boxes and texts being typed, local to this view, as if they were saved. */
	showDrafts(drafts: CanvasDrafts): void {
		if (this.#destroyed) return;
		if (this.#projection.setDrafts(drafts)) notify(this.#subscribers);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#unsubscribe();
		this.#unsubscribeSource();
		this.#subscribers.clear();
		this.#documentSubscribers.clear();
		this.session.destroy();
	}
}

function notify(subscribers: ReadonlySet<() => void>): void {
	for (const subscriber of [...subscribers]) {
		try {
			subscriber();
		} catch {
			// Publication must reach every subscriber.
		}
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

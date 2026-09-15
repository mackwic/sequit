import {
	type CollapsedDocumentProjection,
	projectCollapsedDocument,
} from '../../../lib/core/document/collapsed-document';
import type {
	LogicDocument,
	LogicGroup,
	LogicRelation,
	NewLogicNode,
} from '../../../lib/core/document/logic-document';
import { GroupState } from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import type { DocumentCommandOutcome } from '../../../lib/infrastructure/document/document-command-contracts';
import { parseSequitToml } from '../../../lib/infrastructure/toml/parse-sequit-toml';
import type { DocumentSession } from '../document/document-session';
import { createDocumentSession } from '../document/yjs-document-session';
import type { CanvasMeasurementModel, CanvasModel } from '../ui/canvas/canvas-model';
import type { CanvasProjection } from './canvas-projection';
import { DocumentProjection } from './document-projection';
import type { LayoutMeasurements } from './layout-graph';

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
	readonly #subscribers = new Set<() => void>();
	#destroyed = false;

	constructor(
		private readonly session: DocumentSession,
		projection: DocumentProjection,
	) {
		this.#projection = projection;
		this.#unsubscribe = this.session.subscribe((document) => {
			this.#projection.update(document);
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
		return this.#projection.createCanvasModel(measurements);
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

/** Canvas projection of one accepted/shared snapshot; editing stays on the source document. */
function sharedDocument(document: LogicDocument) {
	const closed = document.groups
		.filter((group) => group.state === GroupState.Closed)
		.map((group) => group.id);
	return projectCollapsedDocument(document, closed);
}

interface SharedProjectionUpdate {
	readonly visible: CollapsedDocumentProjection;
	readonly changed: boolean;
	readonly warning: string | undefined;
}

/** A valid source can acquire a false cycle only in its collapsed view. Keep it expanded. */
function projectSharedSnapshot(
	document: LogicDocument,
	accept: (visible: LogicDocument) => boolean,
): SharedProjectionUpdate {
	const visible = sharedDocument(document);
	try {
		return { visible, changed: accept(visible.document), warning: undefined };
	} catch {
		const expanded = projectCollapsedDocument(document, []);
		return {
			visible: expanded,
			changed: accept(expanded.document),
			warning: 'Ce repli crée une ambiguïté. La vue reste dépliée ; le document est conservé.',
		};
	}
}

class SharedCanvasProjection implements CanvasProjection {
	readonly #projection: DocumentProjection;
	#visible: ReturnType<typeof sharedDocument>;
	#warning: string | undefined;
	readonly #subscribers = new Set<() => void>();

	constructor(document: LogicDocument) {
		this.#projection = new DocumentProjection(document);
		const result = projectSharedSnapshot(document, (visible) => this.#projection.update(visible));
		this.#visible = result.visible;
		this.#warning = result.warning;
	}

	get measurementModel(): CanvasMeasurementModel {
		return this.#projection.measurementModel;
	}

	get visible(): ReturnType<typeof sharedDocument> {
		return this.#visible;
	}

	get warning(): string | undefined {
		return this.#warning;
	}

	update(document: LogicDocument): void {
		const { visible, changed, warning } = projectSharedSnapshot(document, (next) =>
			this.#projection.update(next),
		);
		const provenanceChanged =
			JSON.stringify([...visible.relations]) !== JSON.stringify([...this.#visible.relations]);
		this.#visible = visible;
		this.#warning = warning;
		if (!changed && !provenanceChanged) return;
		for (const subscriber of [...this.#subscribers]) {
			try {
				subscriber();
			} catch {
				/* Isolate view subscribers. */
			}
		}
	}

	subscribe(subscriber: () => void): () => void {
		this.#subscribers.add(subscriber);
		return () => this.#subscribers.delete(subscriber);
	}

	createCanvasModel(measurements: LayoutMeasurements): Promise<CanvasModel> {
		return this.#projection.createCanvasModel(measurements, this.#visible.relations);
	}
}

export function createSharedCanvasProjection(document: LogicDocument): SharedCanvasProjection {
	return new SharedCanvasProjection(document);
}

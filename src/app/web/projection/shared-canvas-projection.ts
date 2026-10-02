import {
	type CollapsedDocumentProjection,
	projectCollapsedDocument,
} from '../../../lib/core/document/collapsed-document';
import { defined, GroupState, type LogicDocument } from '../../../lib/core/document/logic-document';
import {
	createGraph,
	GraphDiagnosticCode,
	type LogicGraph,
} from '../../../lib/core/graph/create-graph';
import {
	topologicallyRank,
	type TopologicalRanks,
} from '../../../lib/core/graph/topological-ranks';
import {
	FoldedGroupLayoutKind,
	tryLayoutFoldedGroup,
} from '../../../lib/core/layout/folded/folded-group-layout';
import {
	type SourceDocumentState,
	SourceDocumentStateKind,
} from '../../../lib/infrastructure/collaboration/source-document-state';
import {
	type CanvasMeasurementModel,
	type CanvasModel,
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../ui/canvas/canvas-model';
import type { CanvasProjection } from './canvas-projection';
import { DocumentProjection } from './document-projection';
import { LayoutProjectionError } from './layout-diagnostic';
import type { LayoutMeasurements } from './layout-graph';
import { type CanvasDrafts, NO_CANVAS_DRAFTS, withDrafts } from './node-draft';
import { SourceDocumentProjectionError } from './source-document-diagnostic';
import { UnresolvedFoldedGroupLayoutError } from './unresolved-folded-group-error';

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
	readonly foldedSource?: {
		readonly graph: LogicGraph;
		readonly ranks: TopologicalRanks;
		readonly closedGroupIds: readonly string[];
	};
}

/** A source-valid false cycle is resolved from source ownership, not visible topology. */
function projectSharedSnapshot(
	document: LogicDocument,
	accept: (visible: LogicDocument, graph?: LogicGraph) => boolean,
): SharedProjectionUpdate {
	const visible = sharedDocument(document);
	if (visible.hiddenEndpointIds.size === 0)
		return { visible, changed: accept(visible.document), warning: undefined };
	const visibleGraph = createGraph(visible.document);
	if (visibleGraph.ok)
		return {
			visible,
			changed: accept(visible.document, visibleGraph.value),
			warning: undefined,
		};
	const failure = defined(visibleGraph.diagnostics[0]);
	if (failure.code !== GraphDiagnosticCode.Cycle) throw new Error(failure.message);
	const sourceGraph = createGraph(document);
	if (!sourceGraph.ok) throw new Error(defined(sourceGraph.diagnostics[0]).message);
	return {
		visible,
		changed: true,
		warning: undefined,
		foldedSource: {
			graph: sourceGraph.value,
			ranks: topologicallyRank(sourceGraph.value),
			closedGroupIds: document.groups
				.filter(({ state }) => state === GroupState.Closed)
				.map(({ id }) => id),
		},
	};
}

export class SharedCanvasProjection implements CanvasProjection {
	readonly #projection: DocumentProjection;
	/** The shared snapshot, without the drafts. */
	#source: LogicDocument;
	/** What is projected: the shared snapshot and the drafts it can hold. */
	#document: LogicDocument;
	#drafts: CanvasDrafts = NO_CANVAS_DRAFTS;
	#sourceState: SourceDocumentState | undefined;
	#visible: ReturnType<typeof sharedDocument>;
	/** The shared snapshot alone, as its readers see it while drafts are drawn. */
	#sourceVisible: CollapsedDocumentProjection | undefined;
	#foldedSource: SharedProjectionUpdate['foldedSource'];
	#foldedMeasurementModel: CanvasMeasurementModel | undefined;
	#warning: string | undefined;
	#layoutFailed = false;
	readonly #subscribers = new Set<() => void>();

	constructor(document: LogicDocument) {
		this.#source = document;
		this.#document = document;
		this.#projection = new DocumentProjection(document);
		const result = projectSharedSnapshot(document, (visible, graph) =>
			this.#projection.update(visible, graph),
		);
		this.#visible = result.visible;
		this.#foldedSource = result.foldedSource;
		if (result.foldedSource !== undefined)
			this.#foldedMeasurementModel = createCanvasMeasurementModel(result.visible.document);
		this.#warning = result.warning;
	}

	get measurementModel(): CanvasMeasurementModel {
		return this.#foldedMeasurementModel ?? this.#projection.measurementModel;
	}

	/** The shared snapshot as shown, folded groups applied; drafts are not part of it. */
	get visible(): CollapsedDocumentProjection {
		if (this.#document === this.#source) return this.#visible;
		this.#sourceVisible ??= sharedDocument(this.#source);
		return this.#sourceVisible;
	}

	get warning(): string | undefined {
		return this.#warning;
	}

	updateSourceState(state: SourceDocumentState): void {
		const wasInvalid = this.#sourceState?.kind === SourceDocumentStateKind.Invalid;
		this.#sourceState = state;
		if (state.kind === SourceDocumentStateKind.Valid) {
			this.update(state.document, wasInvalid);
			return;
		}
		if (state.kind === SourceDocumentStateKind.Invalid) this.#notify();
	}

	update(source: LogicDocument, forcePublish = false): void {
		if (this.#sourceState?.kind === SourceDocumentStateKind.Invalid) return;
		this.#source = source;
		this.#sourceVisible = undefined;
		const document = withDrafts(source, this.#drafts);
		const previouslyFolded = this.#foldedSource !== undefined;
		const sourceChanged = JSON.stringify(document) !== JSON.stringify(this.#document);
		const { visible, changed, warning, foldedSource } = projectSharedSnapshot(
			document,
			(next, graph) => this.#projection.update(next, graph),
		);
		const provenanceChanged =
			JSON.stringify([...visible.relations]) !== JSON.stringify([...this.#visible.relations]);
		this.#visible = visible;
		this.#foldedSource = foldedSource;
		this.#foldedMeasurementModel = undefined;
		if (foldedSource !== undefined)
			this.#foldedMeasurementModel = createCanvasMeasurementModel(visible.document);
		this.#document = document;
		this.#warning = warning;
		let projectionChanged = changed || previouslyFolded;
		if (foldedSource !== undefined) projectionChanged = sourceChanged || !previouslyFolded;
		const retryLayout = this.#layoutFailed;
		this.#layoutFailed = false;
		const shouldPublish = projectionChanged || provenanceChanged || retryLayout || forcePublish;
		if (!shouldPublish) return;
		this.#notify();
	}

	/** Shows boxes and texts still being typed, or not yet accepted, as if they were saved. */
	setDrafts(drafts: CanvasDrafts): boolean {
		if (drafts === this.#drafts) return false;
		this.#drafts = drafts;
		this.update(this.#source);
		return true;
	}

	#notify(): void {
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

	async createCanvasModel(measurements: LayoutMeasurements): Promise<CanvasModel> {
		const source = this.#sourceState;
		if (source?.kind === SourceDocumentStateKind.Invalid)
			throw new SourceDocumentProjectionError(source);
		const document = this.#document;
		try {
			const folded = this.#foldedSource;
			let canvas: CanvasModel;
			if (folded === undefined) {
				canvas = await this.#projection.createCanvasModel(measurements, this.#visible.relations);
			} else {
				const attempt = tryLayoutFoldedGroup(
					folded.graph,
					folded.ranks,
					measurements,
					folded.closedGroupIds,
				);
				if (attempt.kind !== FoldedGroupLayoutKind.Supported)
					throw new UnresolvedFoldedGroupLayoutError(attempt.reason);
				canvas = createCanvasModel(this.measurementModel, attempt.layout, {
					document: this.#visible.document,
					ranks: folded.ranks,
					relationProjections: this.#visible.relations,
				});
			}
			const current = this.#sourceState;
			if (current?.kind === SourceDocumentStateKind.Invalid)
				throw new SourceDocumentProjectionError(current);
			this.#layoutFailed = false;
			return canvas;
		} catch (cause) {
			if (cause instanceof SourceDocumentProjectionError) throw cause;
			const current = this.#sourceState;
			if (current?.kind === SourceDocumentStateKind.Invalid)
				throw new SourceDocumentProjectionError(current);
			this.#layoutFailed = true;
			throw new LayoutProjectionError(document, cause);
		}
	}
}

export function createSharedCanvasProjection(document: LogicDocument): SharedCanvasProjection {
	return new SharedCanvasProjection(document);
}

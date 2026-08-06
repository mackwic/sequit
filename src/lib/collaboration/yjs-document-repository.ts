import * as Y from 'yjs';

import { EndpointKind, type LogicDocument } from '../document/logic-document';
import type { DocumentChangeSet } from '../document/topology-edits';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';
import { createYjsEntityMap, YJS_COLLECTIONS } from './yjs-document-schema';

export type YjsDocumentRepositoryObserver = (
	result: YjsLiveDocumentResult<LogicDocument>,
	origin: unknown,
) => void;

const {
	groups: GROUPS,
	nodes: NODES,
	junctions: JUNCTIONS,
	relations: RELATIONS,
} = YJS_COLLECTIONS;
const REPLACE_MARKDOWN_ORIGIN = Symbol('sequit replace node markdown');

export function replaceNodeMarkdown(
	document: Y.Doc,
	nodeId: string,
	markdown: string,
	origin: unknown = REPLACE_MARKDOWN_ORIGIN,
): boolean {
	const text = document.getMap<Y.Map<unknown>>(NODES).get(nodeId)?.get('markdown');
	if (!(text instanceof Y.Text)) return false;
	document.transact(() => {
		text.delete(0, text.length);
		text.insert(0, markdown);
	}, origin);
	return true;
}

function endpointCollection(kind: EndpointKind): string {
	switch (kind) {
		case EndpointKind.Group:
			return GROUPS;
		case EndpointKind.Node:
			return NODES;
		case EndpointKind.Junction:
			return JUNCTIONS;
	}
}

export class YjsDocumentRepository {
	readonly #observers = new Set<YjsDocumentRepositoryObserver>();
	#persistenceCapture: { result: YjsLiveDocumentResult<LogicDocument> | undefined } | undefined;

	constructor(readonly document: Y.Doc) {
		document.on('afterTransaction', this.#afterTransaction);
	}

	read() {
		return readLogicDocument(this.document);
	}

	persist(
		changes: DocumentChangeSet,
		origin?: unknown,
	): Promise<YjsLiveDocumentResult<LogicDocument>> {
		return Promise.resolve(this.#persist(changes, origin));
	}

	#persist(changes: DocumentChangeSet, origin?: unknown): YjsLiveDocumentResult<LogicDocument> {
		const preflight = this.#validate(changes);
		if (!preflight.ok) return preflight;
		const capture = { result: undefined } as {
			result: YjsLiveDocumentResult<LogicDocument> | undefined;
		};
		let guardedValidation: YjsLiveDocumentResult<LogicDocument> | undefined;
		this.#persistenceCapture = capture;
		try {
			this.document.transact(() => {
				guardedValidation = this.#validate(changes);
				if (!guardedValidation.ok) return;
				this.#apply(changes);
			}, origin);
			if (guardedValidation !== undefined && !guardedValidation.ok) return guardedValidation;
			const result = capture.result;
			if (result === undefined)
				throw new Error('Yjs transaction completed without materialization');
			return result;
		} finally {
			this.#persistenceCapture = undefined;
		}
	}

	#validate(changes: DocumentChangeSet): YjsLiveDocumentResult<LogicDocument> {
		const candidate = new Y.Doc();
		Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.document));
		const candidateRepository = new YjsDocumentRepository(candidate);
		try {
			candidateRepository.#apply(changes);
			return candidateRepository.read();
		} finally {
			candidateRepository.destroy();
			candidate.destroy();
		}
	}

	observe(observer: YjsDocumentRepositoryObserver): () => void {
		this.#observers.add(observer);
		return () => this.#observers.delete(observer);
	}

	destroy(): void {
		this.document.off('afterTransaction', this.#afterTransaction);
		this.#observers.clear();
	}

	#apply(changes: DocumentChangeSet): void {
		const nodes = this.document.getMap<Y.Map<unknown>>(NODES);
		const relations = this.document.getMap<Y.Map<unknown>>(RELATIONS);
		for (const node of changes.nodeAdditions) {
			if (nodes.has(node.id))
				throw new Error(`Node addition conflicts with existing id: ${node.id}`);
		}
		for (const relation of changes.relationAdditions) {
			if (relations.has(relation.id)) {
				throw new Error(`Relation addition conflicts with existing id: ${relation.id}`);
			}
		}
		const orderChanges = changes.endpointOrderChanges.map((change) => {
			const endpoint = this.document
				.getMap<Y.Map<unknown>>(endpointCollection(change.endpointKind))
				.get(change.endpointId);
			if (!(endpoint instanceof Y.Map)) {
				throw new Error(`Endpoint order target is missing: ${change.endpointId}`);
			}
			return { endpoint, order: change.layoutOrder };
		});
		for (const node of changes.nodeAdditions) {
			const markdown = new Y.Text(node.markdown);
			nodes.set(
				node.id,
				createYjsEntityMap({
					natureId: node.natureId,
					...(node.groupId === undefined ? {} : { groupId: node.groupId }),
					layoutOrder: node.layoutOrder,
					markdown,
				}),
			);
		}
		for (const relation of changes.relationAdditions) {
			relations.set(relation.id, createYjsEntityMap({ from: relation.from, to: relation.to }));
		}
		for (const { endpoint, order } of orderChanges) endpoint.set('layoutOrder', order);
	}

	readonly #afterTransaction = (transaction: Y.Transaction): void => {
		const result = this.read();
		if (this.#persistenceCapture !== undefined && this.#persistenceCapture.result === undefined) {
			this.#persistenceCapture.result = result;
		}
		for (const observer of [...this.#observers]) {
			try {
				observer(result, transaction.origin);
			} catch {
				// Repository observers cannot interrupt Yjs transaction delivery.
			}
		}
	};
}

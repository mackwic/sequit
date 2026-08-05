import * as Y from 'yjs';

import { EndpointKind, type LogicDocument } from '../document/logic-document';
import type { DocumentChangeSet } from '../document/topology-edits';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';

export type YjsDocumentRepositoryObserver = (
	result: YjsLiveDocumentResult<LogicDocument>,
	origin: unknown,
) => void;

const GROUPS = 'sequit.groups';
const NODES = 'sequit.nodes';
const JUNCTIONS = 'sequit.junctions';
const RELATIONS = 'sequit.relations';
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

function entityMap(values: Readonly<Record<string, unknown>>): Y.Map<unknown> {
	const result = new Y.Map<unknown>();
	for (const [key, value] of Object.entries(values)) result.set(key, value);
	return result;
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

	constructor(readonly document: Y.Doc) {
		document.on('afterTransaction', this.#afterTransaction);
	}

	read() {
		return readLogicDocument(this.document);
	}

	persist(changes: DocumentChangeSet, origin?: unknown): void {
		this.document.transact(() => {
			this.#apply(changes);
		}, origin);
	}

	replaceNodeMarkdown(nodeId: string, markdown: string, origin?: unknown): boolean {
		return replaceNodeMarkdown(this.document, nodeId, markdown, origin);
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
				entityMap({
					natureId: node.natureId,
					...(node.groupId === undefined ? {} : { groupId: node.groupId }),
					layoutOrder: node.layoutOrder,
					markdown,
				}),
			);
		}
		for (const relation of changes.relationAdditions) {
			relations.set(relation.id, entityMap({ from: relation.from, to: relation.to }));
		}
		for (const { endpoint, order } of orderChanges) endpoint.set('layoutOrder', order);
	}

	readonly #afterTransaction = (transaction: Y.Transaction): void => {
		const result = this.read();
		for (const observer of [...this.#observers]) {
			try {
				observer(result, transaction.origin);
			} catch {
				// Repository observers cannot interrupt Yjs transaction delivery.
			}
		}
	};
}

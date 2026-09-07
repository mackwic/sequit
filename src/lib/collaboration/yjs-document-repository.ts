import * as Y from 'yjs';

import { defined } from '../document/logic-document';
import { EndpointKind, type LogicDocument } from '../document/logic-document';
import type { DocumentChangeSet } from '../document/topology-edits';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';
import { createYjsEntityMap, YjsCollection } from './yjs-document-schema';

export type YjsDocumentRepositoryObserver = (
	result: YjsLiveDocumentResult<LogicDocument>,
	origin: unknown,
) => void;

const GROUPS = YjsCollection.Groups;
const JUNCTIONS = YjsCollection.Junctions;
const NODES = YjsCollection.Nodes;
const RELATIONS = YjsCollection.Relations;
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

const COLLECTION_BY_ENDPOINT_KIND: Readonly<Record<EndpointKind, YjsCollection>> = {
	[EndpointKind.Group]: GROUPS,
	[EndpointKind.Node]: NODES,
	[EndpointKind.Junction]: JUNCTIONS,
};

interface PersistenceCapture {
	result: YjsLiveDocumentResult<LogicDocument> | undefined;
}

export class YjsDocumentRepository {
	readonly #observers = new Set<YjsDocumentRepositoryObserver>();
	#persistenceCapture: PersistenceCapture | undefined;
	#lastValidDocument: Y.Doc | undefined;
	#canRecoverFromLastValid = false;

	constructor(readonly document: Y.Doc) {
		document.on('afterTransaction', this.#afterTransaction);
		if (readLogicDocument(document).ok) this.#lastValidDocument = this.#clone(document);
	}

	read(): YjsLiveDocumentResult<LogicDocument> {
		return readLogicDocument(this.document);
	}

	persist(
		changes: DocumentChangeSet,
		origin?: unknown,
	): Promise<YjsLiveDocumentResult<LogicDocument>> {
		return Promise.resolve(this.#persist(changes, origin));
	}

	#persist(changes: DocumentChangeSet, origin?: unknown): YjsLiveDocumentResult<LogicDocument> {
		const invalidDocument = !this.read().ok;
		const lastValidDocument = this.#lastValidDocument;
		const recoveryAvailable = this.#canRecoverFromLastValid && lastValidDocument !== undefined;
		if (invalidDocument && recoveryAvailable) {
			const recovery = new YjsDocumentRepository(lastValidDocument);
			try {
				const result = recovery.#persist(changes, origin);
				if (result.ok) this.#lastValidDocument = this.#clone(recovery.document);
				return result;
			} finally {
				recovery.destroy();
			}
		}
		// TODO: Avoid cloning and fully decoding the Y.Doc twice per accepted command while
		// preserving the guarded validation against synchronous transaction hooks.
		const preflight = this.#validate(changes);
		if (!preflight.ok) return preflight;
		const capture: PersistenceCapture = { result: undefined };
		let guardedValidation: YjsLiveDocumentResult<LogicDocument> | undefined;
		const stateBefore = Y.decodeStateVector(Y.encodeStateVector(this.document));
		const undo = new Y.UndoManager(
			Object.values(YjsCollection).map((collection) => this.document.getMap(collection)),
			{ trackedOrigins: new Set([origin ?? null]) },
		);
		this.#persistenceCapture = capture;
		try {
			this.document.transact(() => {
				guardedValidation = this.#validate(changes);
				if (!guardedValidation.ok) return;
				this.#apply(changes);
			}, origin);
			if (guardedValidation !== undefined && !guardedValidation.ok) return guardedValidation;
			const result = defined(capture.result);
			if (!result.ok) {
				undo.undo();
				this.#discardRolledBackStructs(stateBefore);
				return result;
			}
			return result;
		} finally {
			undo.destroy();
			this.#persistenceCapture = undefined;
		}
	}

	#clone(source: Y.Doc): Y.Doc {
		const clone = new Y.Doc();
		Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
		return clone;
	}

	#discardRolledBackStructs(stateBefore: Map<number, number>): void {
		// Undo restores the shared types, but its tombstones would still advance this
		// replica's state vector. No update escaped a rejected synchronous command, so
		// discard precisely those unobservable local structs as part of the rollback.
		const store = this.document.store;
		for (const [client, structs] of store.clients) {
			const clock = stateBefore.get(client) ?? 0;
			const firstRolledBack = structs.findIndex(
				(struct) => struct.id.clock + struct.length > clock,
			);
			if (firstRolledBack >= 0) structs.splice(firstRolledBack);
			if (structs.length === 0) store.clients.delete(client);
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
		this.#lastValidDocument?.destroy();
		this.#lastValidDocument = undefined;
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
				.getMap<Y.Map<unknown>>(COLLECTION_BY_ENDPOINT_KIND[change.endpointKind])
				.get(change.endpointId);
			return { endpoint: defined(endpoint), order: change.layoutOrder };
		});
		for (const node of changes.nodeAdditions) {
			const markdown = new Y.Text(node.markdown);
			const values: Record<string, unknown> = {
				natureId: node.natureId,
				layoutOrder: node.layoutOrder,
				markdown,
			};
			if (node.groupId !== undefined) values['groupId'] = node.groupId;
			nodes.set(node.id, createYjsEntityMap(values));
		}
		for (const relation of changes.relationAdditions) {
			relations.set(relation.id, createYjsEntityMap({ from: relation.from, to: relation.to }));
		}
		for (const { endpoint, order } of orderChanges) endpoint.set('layoutOrder', order);
	}

	readonly #afterTransaction = (transaction: Y.Transaction): void => {
		const result = this.read();
		if (result.ok && this.#persistenceCapture === undefined) {
			this.#canRecoverFromLastValid = false;
			this.#lastValidDocument?.destroy();
			this.#lastValidDocument = this.#clone(this.document);
		} else if (!result.ok) {
			// Recovery is only valid after observing a rejected remote merge. A document
			// invalidated locally is an invalid command base and must not be bypassed.
			const remoteTransaction = !transaction.local;
			this.#canRecoverFromLastValid = remoteTransaction && this.#persistenceCapture === undefined;
		}
		if (this.#persistenceCapture !== undefined && this.#persistenceCapture.result === undefined) {
			this.#persistenceCapture.result = result;
		}
		for (const observer of [...this.#observers]) {
			try {
				observer(result, transaction.origin);
			} catch {
				// Repository observers cannot interrupt Yjs transaction delivery.
				// TODO: Report observer failures through an isolated diagnostics channel.
			}
		}
	};
}

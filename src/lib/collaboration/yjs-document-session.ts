import * as Y from 'yjs';

import {
	type DocumentCommandGateway,
	type DocumentCommandOutcome,
	LocalDocumentCommandGateway,
} from '../document/document-command-gateway';
import {
	DocumentSession,
	DocumentSessionError,
	type DocumentSessionErrorReporter,
} from '../document/document-session';
import type { LogicDocument } from '../document/logic-document';
import { importLogicDocument, readLogicDocument } from './yjs-document-codec';
import { YjsDocumentRepository } from './yjs-document-repository';

class YjsSessionGateway implements DocumentCommandGateway {
	readonly #repository: YjsDocumentRepository;
	readonly #commands: LocalDocumentCommandGateway;
	readonly #observers = new Set<(outcome: DocumentCommandOutcome) => void>();
	readonly #stopRepository: () => void;
	#current: LogicDocument;

	constructor(
		document: Y.Doc,
		initial: LogicDocument,
		private readonly ownsDocument: boolean,
	) {
		this.#current = initial;
		this.#repository = new YjsDocumentRepository(document);
		this.#commands = new LocalDocumentCommandGateway(() => this.#current, this.#repository);
		this.#stopRepository = this.#repository.observe((result) => {
			const outcome: DocumentCommandOutcome = result.ok
				? { kind: 'accepted', document: result.value }
				: { kind: 'rejected', diagnostics: result.diagnostics };
			if (outcome.kind === 'accepted') this.#current = outcome.document;
			for (const observer of [...this.#observers]) {
				try {
					observer(outcome);
				} catch {
					// Every session observer receives each repository publication.
				}
			}
		});
	}

	readAccepted(): LogicDocument {
		return this.#current;
	}
	addNode: DocumentCommandGateway['addNode'] = (node) => this.#commands.addNode(node);
	addRelation: DocumentCommandGateway['addRelation'] = (relation) =>
		this.#commands.addRelation(relation);
	subscribe(observer: (outcome: DocumentCommandOutcome) => void): () => void {
		this.#observers.add(observer);
		return () => this.#observers.delete(observer);
	}
	destroy(): void {
		this.#stopRepository();
		this.#commands.destroy();
		this.#repository.destroy();
		this.#observers.clear();
		if (this.ownsDocument) this.#repository.document.destroy();
	}
}

function failure(result: Extract<ReturnType<typeof readLogicDocument>, { ok: false }>): never {
	throw new DocumentSessionError(
		result.diagnostics.map(({ message }) => message).join('; '),
		result.diagnostics,
	);
}

export function createDocumentSession(
	initialDocument: LogicDocument,
	reportError?: DocumentSessionErrorReporter,
): DocumentSession {
	const document = new Y.Doc();
	importLogicDocument(document, initialDocument);
	const decoded = readLogicDocument(document);
	if (!decoded.ok) failure(decoded);
	return new DocumentSession(new YjsSessionGateway(document, decoded.value, true), reportError);
}

export function attachDocumentSession(
	document: Y.Doc,
	reportError?: DocumentSessionErrorReporter,
): DocumentSession {
	const decoded = readLogicDocument(document);
	if (!decoded.ok) failure(decoded);
	return new DocumentSession(new YjsSessionGateway(document, decoded.value, false), reportError);
}

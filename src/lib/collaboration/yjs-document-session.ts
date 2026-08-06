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
	readonly #localCommandOrigin = Symbol('sequit local document command');
	#current: LogicDocument;
	#destroyed = false;

	constructor(
		document: Y.Doc,
		initial: LogicDocument,
		private readonly ownsDocument: boolean,
	) {
		this.#current = initial;
		this.#repository = new YjsDocumentRepository(document);
		// This composed gateway owns publication. Accepted states flow exactly once from the
		// repository observer, which is also the path used for remote Yjs transactions.
		this.#commands = new LocalDocumentCommandGateway(
			() => this.#current,
			this.#repository,
			this.#localCommandOrigin,
			{
				publishAccepted: false,
			},
		);
		this.#stopRepository = this.#repository.observe((result, origin) => {
			if (!result.ok && origin === this.#localCommandOrigin) return;
			const outcome: DocumentCommandOutcome = result.ok
				? { kind: 'accepted', document: result.value }
				: { kind: 'rejected', diagnostics: result.diagnostics };
			if (outcome.kind === 'accepted') this.#current = outcome.document;
			for (const observer of [...this.#observers]) {
				if (this.#destroyed) break;
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
	dispatch: DocumentCommandGateway['dispatch'] = (command) => this.#commands.dispatch(command);
	subscribe(observer: (outcome: DocumentCommandOutcome) => void): () => void {
		this.#observers.add(observer);
		return () => this.#observers.delete(observer);
	}
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
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
	if (reportError instanceof Y.Doc) {
		throw new TypeError(
			'createDocumentSession no longer accepts a Y.Doc as its second argument; use attachDocumentSession',
		);
	}
	if (reportError !== undefined && typeof reportError !== 'function') {
		throw new TypeError('createDocumentSession reporter must be a function');
	}
	const document = new Y.Doc();
	try {
		importLogicDocument(document, initialDocument);
		const decoded = readLogicDocument(document);
		if (!decoded.ok) failure(decoded);
		return new DocumentSession(new YjsSessionGateway(document, decoded.value, true), reportError);
	} catch (error) {
		document.destroy();
		throw error;
	}
}

export function attachDocumentSession(
	document: Y.Doc,
	reportError?: DocumentSessionErrorReporter,
): DocumentSession {
	const decoded = readLogicDocument(document);
	if (!decoded.ok) failure(decoded);
	return new DocumentSession(new YjsSessionGateway(document, decoded.value, false), reportError);
}

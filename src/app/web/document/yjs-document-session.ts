import * as Y from 'yjs';

import type { LogicDocument } from '../../../lib/core/document/logic-document';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../lib/infrastructure/collaboration/yjs-document-codec';
import { YjsDocumentRepository } from '../../../lib/infrastructure/collaboration/yjs-document-repository';
import {
	type DocumentCommandGateway,
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
	DocumentCommandPublicationMode,
} from '../../../lib/infrastructure/document/document-command-contracts';
import {
	DocumentSessionError,
	type DocumentSessionErrorReporter,
} from '../../../lib/infrastructure/document/document-session-contracts';
import { LocalDocumentCommandGateway } from './document-command-gateway';
import { DocumentSession } from './document-session';

class YjsSessionGateway implements DocumentCommandGateway {
	readonly #repository: YjsDocumentRepository;
	readonly #commands: LocalDocumentCommandGateway;
	readonly #observers = new Set<(outcome: DocumentCommandOutcome) => void>();
	readonly #stopRepository: () => void;
	readonly #localCommandOrigin = Symbol('sequit local document command');
	#current: LogicDocument;

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
				publicationMode: DocumentCommandPublicationMode.ObserverOwned,
			},
		);
		this.#stopRepository = this.#repository.observe((result, origin) => {
			if (!result.ok && origin === this.#localCommandOrigin) return;
			// FIXME: An invalid remote merge remains in the physical Y.Doc. Although #current
			// stays valid, subsequent commands still persist against the invalid CRDT state.
			let outcome: DocumentCommandOutcome;
			if (result.ok) {
				this.#current = result.value;
				outcome = { kind: DocumentCommandOutcomeKind.Accepted, document: result.value };
			} else {
				outcome = { kind: DocumentCommandOutcomeKind.Rejected, diagnostics: result.diagnostics };
			}
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
	dispatch: DocumentCommandGateway['dispatch'] = (command) => this.#commands.dispatch(command);
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
	if (reportError instanceof Y.Doc) {
		throw new TypeError(
			'createDocumentSession no longer accepts a Y.Doc as its second argument; use attachDocumentSession',
		);
	}
	let invalidReporter = typeof reportError !== 'function';
	if (reportError === undefined) invalidReporter = false;
	if (invalidReporter) {
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

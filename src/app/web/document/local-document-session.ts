import * as Y from 'yjs';

import type { LogicDocument } from '../../../lib/core/document/logic-document';
import type { DocumentSession } from '../../../lib/infrastructure/collaboration/collaborative-document-session-types';
import { BusinessCommandRefusal } from '../../../lib/infrastructure/collaboration/session-failure';
import {
	CommandRefusalCode,
	SessionNoticeCode,
} from '../../../lib/infrastructure/collaboration/session-reasons';
import { executeSharedCommands } from '../../../lib/infrastructure/collaboration/shared-command-executor';
import { sharedTextAt } from '../../../lib/infrastructure/collaboration/shared-element';
import { spliceSharedText } from '../../../lib/infrastructure/collaboration/shared-text';
import {
	type SourceDocumentState,
	sourceDocumentState,
	SourceDocumentStateKind,
} from '../../../lib/infrastructure/collaboration/source-document-state';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../lib/infrastructure/collaboration/yjs-document-codec';
import { YjsDocumentRepository } from '../../../lib/infrastructure/collaboration/yjs-document-repository';
import type { YjsLiveDocumentResult } from '../../../lib/infrastructure/collaboration/yjs-document-result';
import {
	DocumentCommandDiagnosticCode,
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
	sessionClosedOutcome,
} from '../../../lib/infrastructure/document/document-command-contracts';
import {
	DocumentSessionError,
	DocumentSessionErrorKind,
	type DocumentSessionErrorReport,
	type DocumentSessionErrorReporter,
	type DocumentSessionSubscriber,
} from '../../../lib/infrastructure/document/document-session-contracts';
import type {
	SharedDocumentCommand,
	SharedTarget,
} from '../../../lib/infrastructure/document/shared-document-command';
import { LocalDocumentHistory } from './local-document-history';

type DocumentResult = YjsLiveDocumentResult<LogicDocument>;

const ignoreError: DocumentSessionErrorReporter = () => undefined;

/**
 * Runs each batch with the shared executor on a detached candidate, then merges the candidate's
 * update into the document. Accepted states flow exactly once from the repository observer, which
 * is also the path used for remote Yjs transactions.
 */
export class LocalDocumentSession implements DocumentSession {
	readonly #repository: YjsDocumentRepository;
	readonly #stopRepository: () => void;
	readonly #subscribers = new Set<DocumentSessionSubscriber>();
	readonly #sourceSubscribers = new Set<(state: SourceDocumentState) => void>();
	readonly #publicationQueue: DocumentResult[] = [];
	readonly #commandOrigin = Symbol('sequit local document command');
	readonly #textOrigin = Symbol('sequit local document text');
	readonly history: LocalDocumentHistory;
	#dispatchQueue: Promise<unknown> = Promise.resolve();
	#committed: DocumentResult | undefined;
	#published: LogicDocument;
	#sourceState: SourceDocumentState;
	#publishing = false;
	#destroyed = false;

	constructor(
		private readonly document: Y.Doc,
		initial: LogicDocument,
		private readonly ownsDocument: boolean,
		private readonly reportError: DocumentSessionErrorReporter = ignoreError,
	) {
		this.#published = initial;
		this.#sourceState = { kind: SourceDocumentStateKind.Valid, document: initial, revision: 0 };
		this.#repository = new YjsDocumentRepository(document);
		this.#stopRepository = this.#repository.observe(this.#observe);
		this.history = new LocalDocumentHistory(document, [this.#commandOrigin, this.#textOrigin]);
	}

	read(): LogicDocument {
		this.#assertActive();
		return this.#published;
	}

	readSourceState(): SourceDocumentState {
		this.#assertActive();
		return this.#sourceState;
	}

	subscribe(subscriber: DocumentSessionSubscriber): () => void {
		this.#assertActive();
		this.#subscribers.add(subscriber);
		return () => this.#subscribers.delete(subscriber);
	}

	subscribeToSourceState(subscriber: (state: SourceDocumentState) => void): () => void {
		this.#assertActive();
		this.#sourceSubscribers.add(subscriber);
		return () => this.#sourceSubscribers.delete(subscriber);
	}

	dispatch(commands: readonly SharedDocumentCommand[]): Promise<DocumentCommandOutcome> {
		this.#assertActive();
		const execution = this.#dispatchQueue.then(() => this.#execute(commands));
		this.#dispatchQueue = execution;
		return execution;
	}

	text(target: SharedTarget, field: string): Y.Text | undefined {
		return sharedTextAt(this.document, target, field);
	}

	updateText(target: SharedTarget, field: string, next: string, bound?: Y.Text): boolean {
		if (this.#destroyed) return false;
		const text = sharedTextAt(this.document, target, field);
		if (text === undefined) return false;
		if (bound !== undefined && bound !== text) return false;
		if (text.toJSON() === next) return true;
		this.document.transact(() => {
			spliceSharedText(text, next);
		}, this.#textOrigin);
		return true;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.history.destroy();
		this.#stopRepository();
		this.#repository.destroy();
		this.#subscribers.clear();
		this.#sourceSubscribers.clear();
		if (this.ownsDocument) this.document.destroy();
	}

	#execute(commands: readonly SharedDocumentCommand[]): DocumentCommandOutcome {
		if (this.#closed()) return sessionClosedOutcome();
		const candidate = new Y.Doc({ gc: false });
		try {
			Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.document));
			executeSharedCommands(candidate, commands);
			return this.#commit(Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(this.document)));
		} catch (error) {
			if (!(error instanceof BusinessCommandRefusal))
				return { kind: DocumentCommandOutcomeKind.Failed, error };
			return {
				kind: DocumentCommandOutcomeKind.Rejected,
				diagnostics: [
					{
						code: DocumentCommandDiagnosticCode.CommandRefused,
						message: error.message,
						path: [],
						reason: error.reason,
					},
				],
			};
		} finally {
			candidate.destroy();
		}
	}

	#commit(update: Uint8Array): DocumentCommandOutcome {
		Y.applyUpdate(this.document, update, this.#commandOrigin);
		const committed = this.#takeCommitted();
		if (committed === undefined || this.#closed()) return sessionClosedOutcome();
		if (!committed.ok)
			return { kind: DocumentCommandOutcomeKind.Rejected, diagnostics: committed.diagnostics };
		return { kind: DocumentCommandOutcomeKind.Accepted, document: committed.value };
	}

	#takeCommitted(): DocumentResult | undefined {
		const committed = this.#committed;
		this.#committed = undefined;
		return committed;
	}

	readonly #observe = (result: DocumentResult, origin: unknown, revision: number): void => {
		if (origin === this.#commandOrigin) this.#committed = result;
		this.#publishSourceState(sourceDocumentState(this.document, result, revision));
		// A command's own invalid materialization is its rejection, not an external report.
		if (!result.ok && origin === this.#commandOrigin) return;
		this.#publish(result);
	};

	#publishSourceState(state: SourceDocumentState): void {
		this.#sourceState = state;
		for (const subscriber of [...this.#sourceSubscribers]) {
			if (this.#destroyed) break;
			try {
				subscriber(state);
			} catch (error) {
				this.#report({ kind: DocumentSessionErrorKind.Subscriber, error });
			}
		}
	}

	#publish(result: DocumentResult): void {
		if (this.#destroyed) return;
		this.#publicationQueue.push(result);
		if (this.#publishing) return;
		this.#publishing = true;
		try {
			let next = this.#publicationQueue.shift();
			while (next !== undefined && !this.#closed()) {
				this.#publishOne(next);
				next = this.#publicationQueue.shift();
			}
		} finally {
			this.#publishing = false;
		}
	}

	#publishOne(result: DocumentResult): void {
		if (!result.ok) {
			this.#report({
				kind: DocumentSessionErrorKind.RejectedExternalTransaction,
				diagnostics: result.diagnostics,
			});
			return;
		}
		this.#published = result.value;
		for (const subscriber of [...this.#subscribers]) {
			if (this.#destroyed) break;
			try {
				subscriber(result.value);
			} catch (error) {
				this.#report({ kind: DocumentSessionErrorKind.Subscriber, error });
			}
		}
	}

	#report(report: DocumentSessionErrorReport): void {
		try {
			this.reportError(report);
		} catch {
			// Reporting is isolated from publication.
		}
	}

	#closed(): boolean {
		return this.#destroyed || this.document.isDestroyed;
	}

	#assertActive(): void {
		if (this.#destroyed) throw new DocumentSessionError({ code: SessionNoticeCode.Destroyed });
	}
}

function decoded(document: Y.Doc): LogicDocument {
	const result = readLogicDocument(document);
	if (result.ok) return result.value;
	throw new DocumentSessionError(
		{
			code: CommandRefusalCode.InvalidDocument,
			details: result.diagnostics.map(({ message }) => message),
		},
		result.diagnostics,
	);
}

/** Owns a new Y.Doc seeded with the document; destroying the session destroys it. */
export function createLocalDocumentSession(
	initialDocument: LogicDocument,
	reportError?: DocumentSessionErrorReporter,
): LocalDocumentSession {
	const document = new Y.Doc();
	try {
		importLogicDocument(document, initialDocument);
		return new LocalDocumentSession(document, decoded(document), true, reportError);
	} catch (error) {
		document.destroy();
		throw error;
	}
}

/** Borrows a populated Y.Doc; its owner remains responsible for destroying it. */
export function attachLocalDocumentSession(
	document: Y.Doc,
	reportError?: DocumentSessionErrorReporter,
): LocalDocumentSession {
	return new LocalDocumentSession(document, decoded(document), false, reportError);
}

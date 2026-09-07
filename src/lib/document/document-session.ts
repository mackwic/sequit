import type {
	DocumentCommandDiagnostic,
	DocumentCommandGateway,
	DocumentCommandOutcome,
} from './document-command-gateway';
import { DocumentCommandKind, DocumentCommandOutcomeKind } from './document-command-gateway';
import type { LogicDocument, LogicRelation, NewLogicNode } from './logic-document';
import { defined } from './logic-document';

export class DocumentSessionError extends Error {
	constructor(
		message: string,
		readonly diagnostics: readonly DocumentCommandDiagnostic[] = [],
	) {
		super(message);
		this.name = 'DocumentSessionError';
	}
}

export type DocumentSessionSubscriber = (document: LogicDocument) => void;
export enum DocumentSessionErrorKind {
	Subscriber = 'subscriber-error',
	RejectedExternalTransaction = 'rejected-external-transaction',
	AsynchronousCommandOutcome = 'asynchronous-command-outcome',
}
interface SubscriberErrorReport {
	readonly kind: DocumentSessionErrorKind.Subscriber;
	readonly error: unknown;
}
interface RejectedExternalTransactionReport {
	readonly kind: DocumentSessionErrorKind.RejectedExternalTransaction;
	readonly diagnostics: readonly DocumentCommandDiagnostic[];
}
interface AcceptedOutcome {
	readonly kind: DocumentCommandOutcomeKind.Accepted;
}
interface AsynchronousCommandOutcomeReport {
	readonly kind: DocumentSessionErrorKind.AsynchronousCommandOutcome;
	readonly outcome: Exclude<DocumentCommandOutcome, AcceptedOutcome>;
}
export type DocumentSessionErrorReport =
	SubscriberErrorReport | RejectedExternalTransactionReport | AsynchronousCommandOutcomeReport;
export type DocumentSessionErrorReporter = (report: DocumentSessionErrorReport) => void;

const ignoreError: DocumentSessionErrorReporter = () => undefined;

export class DocumentSession {
	readonly #subscribers = new Set<DocumentSessionSubscriber>();
	readonly #stopObserving: () => void;
	#publishedDocument: LogicDocument;
	#destroyed = false;
	#publishing = false;
	readonly #publicationQueue: DocumentCommandOutcome[] = [];

	constructor(
		private readonly gateway: DocumentCommandGateway,
		private readonly reportError: DocumentSessionErrorReporter = ignoreError,
	) {
		this.#publishedDocument = gateway.readAccepted();
		this.#stopObserving = gateway.subscribe(this.#publish);
	}

	read(): LogicDocument {
		this.#assertActive();
		return this.#publishedDocument;
	}

	async addNode(node: NewLogicNode): Promise<LogicDocument> {
		this.#assertActive();
		const outcome = await this.gateway.dispatch({ kind: DocumentCommandKind.AddNode, node });
		this.#assertActive();
		return this.#unwrap(outcome);
	}

	async addRelation(relation: LogicRelation): Promise<LogicDocument> {
		this.#assertActive();
		const outcome = await this.gateway.dispatch({
			kind: DocumentCommandKind.AddRelation,
			relation,
		});
		this.#assertActive();
		return this.#unwrap(outcome);
	}

	subscribe(subscriber: DocumentSessionSubscriber): () => void {
		this.#assertActive();
		this.#subscribers.add(subscriber);
		return () => this.#subscribers.delete(subscriber);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#stopObserving();
		this.#subscribers.clear();
		this.gateway.destroy();
	}

	#unwrap(outcome: DocumentCommandOutcome): LogicDocument {
		if (outcome.kind === DocumentCommandOutcomeKind.Accepted) return outcome.document;
		if (outcome.kind === DocumentCommandOutcomeKind.Failed) {
			if (outcome.error instanceof Error) throw outcome.error;
			throw new DocumentSessionError(String(outcome.error));
		}
		throw new DocumentSessionError(
			outcome.diagnostics.map(({ message }) => message).join('; '),
			outcome.diagnostics,
		);
	}

	readonly #publish = (outcome: DocumentCommandOutcome): void => {
		if (this.#destroyed) return;
		this.#publicationQueue.push(outcome);
		if (this.#publishing) return;
		this.#publishing = true;
		try {
			while (this.#publicationQueue.length > 0) {
				if (this.#isDestroyed()) {
					this.#publicationQueue.length = 0;
					break;
				}
				this.#publishOne(defined(this.#publicationQueue.shift()));
			}
		} finally {
			this.#publishing = false;
		}
	};

	#publishOne(outcome: DocumentCommandOutcome): void {
		if (this.#destroyed) return;
		if (outcome.kind !== DocumentCommandOutcomeKind.Accepted) {
			if (outcome.kind === DocumentCommandOutcomeKind.Rejected) {
				this.#report({
					kind: DocumentSessionErrorKind.RejectedExternalTransaction,
					diagnostics: outcome.diagnostics,
				});
			} else {
				this.#report({ kind: DocumentSessionErrorKind.AsynchronousCommandOutcome, outcome });
			}
			return;
		}
		this.#publishedDocument = outcome.document;
		for (const subscriber of [...this.#subscribers]) {
			if (this.#isDestroyed()) break;
			try {
				subscriber(outcome.document);
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

	#assertActive(): void {
		if (this.#destroyed) throw new DocumentSessionError('Document session has been destroyed');
	}

	#isDestroyed(): boolean {
		return this.#destroyed;
	}
}

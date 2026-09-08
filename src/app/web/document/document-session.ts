import type {
	LogicDocument,
	LogicRelation,
	NewLogicNode,
} from '../../../lib/core/document/logic-document';
import { defined } from '../../../lib/core/document/logic-document';
import type {
	DocumentCommandGateway,
	DocumentCommandOutcome,
} from '../../../lib/infrastructure/document/document-command-contracts';
import {
	DocumentCommandDiagnosticCode,
	DocumentCommandKind,
	DocumentCommandOutcomeKind,
} from '../../../lib/infrastructure/document/document-command-contracts';
import {
	DocumentSessionError,
	DocumentSessionErrorKind,
	type DocumentSessionErrorReport,
	type DocumentSessionErrorReporter,
	type DocumentSessionSubscriber,
} from '../../../lib/infrastructure/document/document-session-contracts';

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

	async replaceNodeMarkdown(nodeId: string, markdown: string): Promise<DocumentCommandOutcome> {
		if (this.#isDestroyed()) return this.#closedOutcome();
		let outcome: DocumentCommandOutcome;
		try {
			outcome = await this.gateway.dispatch({
				kind: DocumentCommandKind.ReplaceNodeMarkdown,
				nodeId,
				markdown,
			});
		} catch (error) {
			outcome = { kind: DocumentCommandOutcomeKind.Failed, error };
		}
		if (this.#isDestroyed()) return this.#closedOutcome();
		return outcome;
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

	#closedOutcome(): DocumentCommandOutcome {
		return {
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [
				{
					code: DocumentCommandDiagnosticCode.SessionClosed,
					message: 'Document session has been destroyed',
					path: [],
				},
			],
		};
	}

	#assertActive(): void {
		if (this.#destroyed) throw new DocumentSessionError('Document session has been destroyed');
	}

	#isDestroyed(): boolean {
		return this.#destroyed;
	}
}

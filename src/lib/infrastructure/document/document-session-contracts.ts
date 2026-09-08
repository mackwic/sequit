import type { LogicDocument } from '../../core/document/logic-document';
import type {
	DocumentCommandDiagnostic,
	DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from './document-command-contracts';

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

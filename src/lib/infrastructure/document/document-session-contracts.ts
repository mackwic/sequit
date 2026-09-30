import type { LogicDocument } from '../../core/document/logic-document';
import type { DocumentCommandDiagnostic } from './document-command-contracts';

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
}
interface SubscriberErrorReport {
	readonly kind: DocumentSessionErrorKind.Subscriber;
	readonly error: unknown;
}
interface RejectedExternalTransactionReport {
	readonly kind: DocumentSessionErrorKind.RejectedExternalTransaction;
	readonly diagnostics: readonly DocumentCommandDiagnostic[];
}
export type DocumentSessionErrorReport = SubscriberErrorReport | RejectedExternalTransactionReport;
export type DocumentSessionErrorReporter = (report: DocumentSessionErrorReport) => void;

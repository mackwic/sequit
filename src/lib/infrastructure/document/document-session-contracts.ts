import type { LogicDocument } from '../../core/document/logic-document';
import type { SessionReason } from '../collaboration/session-reasons';
import type { DocumentCommandDiagnostic } from './document-command-contracts';

export class DocumentSessionError extends Error {
	constructor(
		readonly reason: SessionReason,
		readonly diagnostics: readonly DocumentCommandDiagnostic[] = [],
	) {
		super(reason.code);
		this.name = 'DocumentSessionError';
	}
}

export type DocumentSessionSubscriber = (document: LogicDocument) => void;

/** Whether a step back or forward is available right now. */
export interface DocumentHistoryAvailability {
	readonly undo: boolean;
	readonly redo: boolean;
}

/**
 * Local history over the session's own edits: every accepted batch or text save is one step.
 * Undo and redo publish through the same path as any other transaction; they do nothing and
 * return false when no step is available.
 */
export interface DocumentHistory {
	availability(): DocumentHistoryAvailability;
	subscribe(listener: (availability: DocumentHistoryAvailability) => void): () => void;
	undo(): boolean;
	redo(): boolean;
}
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

import type { LogicDocument } from '../../core/document/logic-document';

export interface DocumentCommandDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
	readonly expectedOrder?: readonly string[];
	readonly materializedOrder?: readonly string[];
	readonly expectedScore?: number;
	readonly materializedScore?: number;
}

export enum DocumentCommandDiagnosticCode {
	NodeNotFound = 'node-not-found',
	NodeMarkdownUnavailable = 'node-markdown-unavailable',
	CommandRefused = 'command-refused',
	SessionClosed = 'document-session-closed',
}

export enum DocumentCommandOutcomeKind {
	Accepted = 'accepted',
	Rejected = 'rejected',
	Failed = 'failed',
}
interface AcceptedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Accepted;
	readonly document: LogicDocument;
}
export interface RejectedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Rejected;
	readonly diagnostics: readonly DocumentCommandDiagnostic[];
}
interface FailedCommandOutcome {
	readonly kind: DocumentCommandOutcomeKind.Failed;
	readonly error: unknown;
}
/** The decision on one atomic batch of `SharedDocumentCommand`s. */
export type DocumentCommandOutcome =
	AcceptedCommandOutcome | RejectedCommandOutcome | FailedCommandOutcome;

export function sessionClosedOutcome(): RejectedCommandOutcome {
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

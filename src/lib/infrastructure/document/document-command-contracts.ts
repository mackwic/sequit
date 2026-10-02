import type { LogicDocument } from '../../core/document/logic-document';
import { SessionNoticeCode, type SessionReason } from '../collaboration/session-reasons';

export interface DocumentCommandDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
	readonly reason?: SessionReason;
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
				message: SessionNoticeCode.Destroyed,
				path: [],
				reason: { code: SessionNoticeCode.Destroyed },
			},
		],
	};
}

export function nodeEditingUnavailableOutcome(
	code:
		| DocumentCommandDiagnosticCode.NodeNotFound
		| DocumentCommandDiagnosticCode.NodeMarkdownUnavailable,
	nodeId: string,
): RejectedCommandOutcome {
	let reason: SessionReason = { code: SessionNoticeCode.NodeMarkdownUnavailable, nodeId };
	if (code === DocumentCommandDiagnosticCode.NodeNotFound)
		reason = { code: SessionNoticeCode.NodeNotFound, nodeId };
	return {
		kind: DocumentCommandOutcomeKind.Rejected,
		diagnostics: [{ code, message: reason.code, path: ['nodes', nodeId], reason }],
	};
}

import type { SharedDocumentCommand, SharedTarget } from '../document/shared-document-command';
import type { CommandSequence } from './command-sequence';
import type { ParticipantPresence } from './participant-presence';
import type {
	CommandRefusal,
	ConflictCode,
	SessionFailureCode,
	SessionRejection,
} from './session-reasons';

export enum SessionMessageKind {
	Sync = 'sync',
	Initialize = 'initialize',
	Change = 'change',
	Commit = 'commit',
	Reject = 'reject',
	Retry = 'retry',
	Conflict = 'conflict',
	Presence = 'presence',
}

interface InitializeMessage {
	readonly type: SessionMessageKind.Initialize;
	readonly id: string;
	readonly update: Uint8Array;
}

interface SyncMessage {
	readonly type: SessionMessageKind.Sync;
	readonly payload: Uint8Array;
}

interface CommandMessage extends CommandSequence {
	readonly type: SessionMessageKind.Change;
	readonly id: string;
	readonly commands: readonly SharedDocumentCommand[];
}

export interface TextTargetReference {
	readonly target: SharedTarget;
	readonly field: string;
	readonly textId: { readonly client: number; readonly clock: number };
}

export interface IdentifiedTextMessage extends TextTargetReference {
	readonly type: SessionMessageKind.Change;
	readonly update: Uint8Array;
	readonly id: string;
	readonly sessionId: string;
}

interface CommitMessage {
	readonly type: SessionMessageKind.Commit;
	readonly update: Uint8Array;
	readonly commit: number;
	readonly id?: string;
}

interface RejectMessage {
	readonly type: SessionMessageKind.Reject;
	readonly code: SessionFailureCode;
	readonly reason: SessionRejection;
}

interface RetryMessage {
	readonly type: SessionMessageKind.Retry;
	readonly code: SessionFailureCode;
	readonly reason: SessionRejection;
}

interface LegacyTextMessage {
	readonly type: SessionMessageKind.Change;
	readonly update: Uint8Array;
	readonly id?: never;
}

export interface CommandConflictMessage {
	readonly type: SessionMessageKind.Conflict;
	readonly code: ConflictCode.CommandConflict | ConflictCode.InvalidCommand;
	readonly reason: CommandRefusal;
	readonly id: string;
	readonly lastAcceptedSequence: number;
}

interface TextTargetGoneMessage {
	readonly type: SessionMessageKind.Conflict;
	readonly code: ConflictCode.TextTargetGone;
	readonly id: string;
	readonly target: SharedTarget;
}

interface PresenceMessage {
	readonly type: SessionMessageKind.Presence;
	readonly participants: readonly ParticipantPresence[];
}

export type SessionMessage =
	| InitializeMessage
	| SyncMessage
	| CommandMessage
	| IdentifiedTextMessage
	| LegacyTextMessage
	| CommitMessage
	| RejectMessage
	| RetryMessage
	| CommandConflictMessage
	| TextTargetGoneMessage
	| PresenceMessage;

interface LegacyRejectMessage {
	readonly type: SessionMessageKind.Reject;
	readonly message: string;
	readonly code?: SessionFailureCode;
}

interface LegacyRetryMessage {
	readonly type: SessionMessageKind.Retry;
	readonly message: string;
	readonly code: SessionFailureCode;
}

interface LegacyCommandConflictMessage {
	readonly type: SessionMessageKind.Conflict;
	readonly code: ConflictCode.CommandConflict | ConflictCode.InvalidCommand;
	readonly message: string;
	readonly id: string;
	readonly lastAcceptedSequence: number;
}

interface LegacyTextTargetGoneMessage {
	readonly type: SessionMessageKind.Conflict;
	readonly code: ConflictCode.TextTargetGone;
	readonly message: string;
	readonly id: string;
	readonly target: SharedTarget;
}

export type LegacySessionMessage =
	| InitializeMessage
	| SyncMessage
	| CommandMessage
	| IdentifiedTextMessage
	| LegacyTextMessage
	| CommitMessage
	| LegacyRejectMessage
	| LegacyRetryMessage
	| LegacyCommandConflictMessage
	| LegacyTextTargetGoneMessage
	| PresenceMessage;

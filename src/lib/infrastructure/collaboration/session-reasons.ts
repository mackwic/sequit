import type { SharedTarget } from '../document/shared-document-command';
export enum SessionFailureCode {
	InvalidMessage = 'invalid-message',
	InvalidDocument = 'invalid-document',
	StorageUnavailable = 'storage-unavailable',
	CommandGap = 'command-gap',
	CorruptCommandReceipt = 'corrupt-command-receipt',
	RepeatedCommandRefusal = 'repeated-command-refusal',
}
export enum ConflictCode {
	CommandConflict = 'command-conflict',
	InvalidCommand = 'invalid-command',
	TextTargetGone = 'text-target-gone',
}

export enum CommandRefusalCode {
	IdentifierExists = 'identifier-exists',
	GroupMemberMissing = 'group-member-missing',
	ElementsDifferentRegion = 'elements-different-region',
	ElementsDifferentLane = 'elements-different-lane',
	GroupSelectionRequired = 'group-selection-required',
	ElementsDifferentGroup = 'elements-different-group',
	NatureReplacementRequired = 'nature-replacement-required',
	NatureReplacementDifferent = 'nature-replacement-different',
	InvalidDocument = 'invalid-document',
	UnknownCommand = 'unknown-command',
	DocumentMissing = 'document-missing',
	ElementMissing = 'element-missing',
	MinimumLanes = 'minimum-lanes',
	InvalidLaneId = 'invalid-lane-id',
	LaneNameRequired = 'lane-name-required',
	RegionalLanesRequired = 'regional-lanes-required',
	UnknownDestinationLane = 'unknown-destination-lane',
	NodesDifferentLane = 'nodes-different-lane',
	NodesDifferentRegion = 'nodes-different-region',
	InvalidRegionPresentation = 'invalid-region-presentation',
	GroupMissing = 'group-missing',
	GroupSelfContainment = 'group-self-containment',
	DuplicateRelationId = 'duplicate-relation-id',
	DuplicateRelation = 'duplicate-relation',
}

/** Refusals that need nothing beyond their code to be explained. */
export const PLAIN_COMMAND_REFUSAL_CODES = [
	CommandRefusalCode.IdentifierExists,
	CommandRefusalCode.GroupMemberMissing,
	CommandRefusalCode.ElementsDifferentRegion,
	CommandRefusalCode.ElementsDifferentLane,
	CommandRefusalCode.GroupSelectionRequired,
	CommandRefusalCode.ElementsDifferentGroup,
	CommandRefusalCode.NatureReplacementRequired,
	CommandRefusalCode.NatureReplacementDifferent,
	CommandRefusalCode.UnknownCommand,
	CommandRefusalCode.DocumentMissing,
	CommandRefusalCode.MinimumLanes,
	CommandRefusalCode.LaneNameRequired,
	CommandRefusalCode.RegionalLanesRequired,
	CommandRefusalCode.NodesDifferentLane,
	CommandRefusalCode.NodesDifferentRegion,
	CommandRefusalCode.InvalidRegionPresentation,
	CommandRefusalCode.GroupSelfContainment,
] as const;

interface PlainCommandRefusal {
	readonly code: (typeof PLAIN_COMMAND_REFUSAL_CODES)[number];
}

/** A refusal whose technical validation details stay untranslated. */
interface InvalidDocumentRefusal {
	readonly code: CommandRefusalCode.InvalidDocument;
	readonly details: readonly string[];
}

interface ElementMissingRefusal {
	readonly code: CommandRefusalCode.ElementMissing;
	readonly target: SharedTarget;
}

interface InvalidLaneIdRefusal {
	readonly code: CommandRefusalCode.InvalidLaneId;
	readonly laneId: string;
}

interface UnknownDestinationLaneRefusal {
	readonly code: CommandRefusalCode.UnknownDestinationLane;
	readonly target: string;
}

interface GroupMissingRefusal {
	readonly code: CommandRefusalCode.GroupMissing;
	readonly groupId: string;
}

interface DuplicateRelationIdRefusal {
	readonly code: CommandRefusalCode.DuplicateRelationId;
	readonly relationId: string;
}

interface DuplicateRelationRefusal {
	readonly code: CommandRefusalCode.DuplicateRelation;
	readonly from: string;
	readonly to: string;
	readonly relationId: string;
}

export type CommandRefusal =
	| PlainCommandRefusal
	| InvalidDocumentRefusal
	| ElementMissingRefusal
	| InvalidLaneIdRefusal
	| UnknownDestinationLaneRefusal
	| GroupMissingRefusal
	| DuplicateRelationIdRefusal
	| DuplicateRelationRefusal;

interface InvalidSessionInput {
	readonly code: SessionFailureCode.InvalidMessage | SessionFailureCode.InvalidDocument;
	readonly details: readonly string[];
}

interface PlainSessionFailure {
	readonly code:
		| SessionFailureCode.StorageUnavailable
		| SessionFailureCode.CommandGap
		| SessionFailureCode.RepeatedCommandRefusal;
}

interface CorruptCommandReceipt {
	readonly code: SessionFailureCode.CorruptCommandReceipt;
	readonly sessionId: string;
}

export type SessionRejection = InvalidSessionInput | PlainSessionFailure | CorruptCommandReceipt;

export enum SessionNoticeCode {
	ActionRefused = 'action-refused',
	UnacknowledgedTitleAbandoned = 'unacknowledged-title-abandoned',
	UnacknowledgedNodesAbandoned = 'unacknowledged-nodes-abandoned',
	UnsentTextAbandoned = 'unsent-text-abandoned',
	SynchronizationFailed = 'synchronization-failed',
	ConnectionRequired = 'connection-required',
	InvalidMessage = 'session-invalid-message',
	Destroyed = 'session-destroyed',
	NodeNotFound = 'node-not-found',
	NodeMarkdownUnavailable = 'node-markdown-unavailable',
}

interface ActionRefusedNotice {
	readonly code: SessionNoticeCode.ActionRefused;
	readonly id: string;
	readonly reason: CommandRefusal;
}

interface PlainSessionNotice {
	readonly code:
		| SessionNoticeCode.UnacknowledgedTitleAbandoned
		| SessionNoticeCode.ConnectionRequired
		| SessionNoticeCode.InvalidMessage
		| SessionNoticeCode.Destroyed;
}

interface UnacknowledgedNodesNotice {
	readonly code: SessionNoticeCode.UnacknowledgedNodesAbandoned;
	readonly nodeIds: readonly string[];
}

interface UnsentTextNotice {
	readonly code: SessionNoticeCode.UnsentTextAbandoned;
	readonly target: SharedTarget;
}

interface SynchronizationFailedNotice {
	readonly code: SessionNoticeCode.SynchronizationFailed;
	readonly reason: SessionRejection;
}

interface NodeEditNotice {
	readonly code: SessionNoticeCode.NodeNotFound | SessionNoticeCode.NodeMarkdownUnavailable;
	readonly nodeId: string;
}

export type SessionNotice =
	| ActionRefusedNotice
	| PlainSessionNotice
	| UnacknowledgedNodesNotice
	| UnsentTextNotice
	| SynchronizationFailedNotice
	| NodeEditNotice;

export type SessionReason = CommandRefusal | SessionNotice | SessionRejection;

import * as Y from 'yjs';

import {
	CollaborativeSessionDiagnosticCode,
	OperationDropReason,
	type ProposalDecision,
	ProposalDecisionKind,
} from './collaborative-document-session-types';
import type { PendingOperation } from './pending-operations';
import type { ProtocolDiagnostic } from './protocol';
import { CollabMessageKind, encodeCollabMessage, ProposalIntent } from './protocol';
import { RoomDecisionDiagnosticCode } from './room-decision';

export enum CommitApplication {
	Ignore = 'ignore',
	Apply = 'apply',
	IncrementalResync = 'incremental-resync',
}

export function planCommitApplication(lastCommit: number, frameCommit: number): CommitApplication {
	if (frameCommit <= lastCommit) return CommitApplication.Ignore;
	if (frameCommit === lastCommit + 1) return CommitApplication.Apply;
	return CommitApplication.IncrementalResync;
}

export enum SessionPhaseKind {
	FirstSync = 'first-sync',
	Initializing = 'initializing',
	Ready = 'ready',
	IncrementalResync = 'incremental-resync',
	FullResync = 'full-resync',
	Disconnected = 'disconnected',
}

interface InFlightProposal {
	readonly operation: PendingOperation;
	readonly proposalId: string;
}

interface FirstSyncPhase {
	readonly kind: SessionPhaseKind.FirstSync;
}

interface InitializingPhase {
	readonly kind: SessionPhaseKind.Initializing;
	readonly proposalId: string;
}

interface ReadyPhase {
	readonly kind: SessionPhaseKind.Ready;
	readonly inFlight?: InFlightProposal;
}

interface IncrementalResyncPhase {
	readonly kind: SessionPhaseKind.IncrementalResync;
}

interface FullResyncPhase {
	readonly kind: SessionPhaseKind.FullResync;
}

interface DisconnectedPhase {
	readonly kind: SessionPhaseKind.Disconnected;
}

export type SessionPhase =
	| FirstSyncPhase
	| InitializingPhase
	| ReadyPhase
	| IncrementalResyncPhase
	| FullResyncPhase
	| DisconnectedPhase;

export function acceptedDecision(proposalId: string | undefined, commit: number): ProposalDecision {
	const decision: ProposalDecision = { type: ProposalDecisionKind.Accepted, commit };
	if (proposalId === undefined) return decision;
	return { ...decision, proposalId };
}

export function droppedDecision(operation: PendingOperation): ProposalDecision {
	return {
		type: ProposalDecisionKind.OperationDropped,
		reason: OperationDropReason.StaleTarget,
		diagnostics: [
			{
				code: CollaborativeSessionDiagnosticCode.StaleOperationTarget,
				message: `Node no longer exists: ${operation.nodeId}`,
				path: ['nodes', operation.nodeId],
			},
		],
	};
}

export function initializationWasLost(diagnostics: readonly ProtocolDiagnostic[]): boolean {
	const expected: string = RoomDecisionDiagnosticCode.RoomAlreadyInitialized;
	return diagnostics.some(({ code }) => code === expected);
}

export function encodeSyncRequest(document: Y.Doc, lastCommit: number, full: boolean): Uint8Array {
	let vectorDocument = document;
	let requestedCommit = lastCommit;
	if (full) {
		vectorDocument = new Y.Doc();
		requestedCommit = 0;
	}
	const message = encodeCollabMessage({
		type: CollabMessageKind.SyncRequest,
		lastCommit: requestedCommit,
		stateVector: Y.encodeStateVector(vectorDocument),
	});
	if (full) vectorDocument.destroy();
	return message;
}

export function encodeInitializationProposal(document: Y.Doc, proposalId: string): Uint8Array {
	return encodeCollabMessage({
		type: CollabMessageKind.Proposal,
		proposalId,
		intent: ProposalIntent.Initialize,
		update: Y.encodeStateAsUpdate(document),
	});
}

import type { LogicDocument } from '../document/logic-document';
import { ProposalIntent, type ProposalMessage, type ProtocolDiagnostic } from './protocol';
import { CHUNK_BYTES, MAX_CHUNKS } from './room-persistence';

export interface RoomSnapshot {
	readonly roomId: string | undefined;
	readonly commit: number;
	readonly acceptedProposals: ReadonlyMap<string, number>;
}

export enum GateDecisionKind {
	Proceed = 'proceed',
	ReAcknowledge = 're-acknowledge',
	Reject = 'reject',
}

export enum RoomDecisionDiagnosticCode {
	RoomAlreadyInitialized = 'room-already-initialized',
	RoomNotInitialized = 'room-not-initialized',
	DocumentRoomMismatch = 'document-room-mismatch',
	DocumentTooLarge = 'document-too-large',
}

interface ProceedDecision {
	readonly kind: GateDecisionKind.Proceed;
}

interface ReAcknowledgeDecision {
	readonly kind: GateDecisionKind.ReAcknowledge;
	readonly commit: number;
}

interface RejectDecision {
	readonly kind: GateDecisionKind.Reject;
	readonly diagnostics: readonly ProtocolDiagnostic[];
}

export type GateDecision = ProceedDecision | ReAcknowledgeDecision | RejectDecision;

function reject(
	code: RoomDecisionDiagnosticCode,
	message: string,
	path: readonly string[],
): RejectDecision {
	return { kind: GateDecisionKind.Reject, diagnostics: [{ code, message, path }] };
}

export function preAuthorizationGate(
	snapshot: RoomSnapshot,
	proposal: ProposalMessage,
): GateDecision {
	const previousCommit = snapshot.acceptedProposals.get(proposal.proposalId);
	if (previousCommit !== undefined) {
		return { kind: GateDecisionKind.ReAcknowledge, commit: previousCommit };
	}

	const initialized = snapshot.commit > 0;
	if (proposal.intent === ProposalIntent.Initialize && initialized) {
		return reject(
			RoomDecisionDiagnosticCode.RoomAlreadyInitialized,
			'Room already has authoritative state; synchronize instead',
			['proposal', 'intent'],
		);
	}
	if (proposal.intent === ProposalIntent.Change && !initialized) {
		return reject(
			RoomDecisionDiagnosticCode.RoomNotInitialized,
			'Room has no authoritative document yet',
			['proposal', 'intent'],
		);
	}
	return { kind: GateDecisionKind.Proceed };
}

export function postAuthorizationGate(
	snapshot: RoomSnapshot,
	proposal: ProposalMessage,
	candidateDocument: LogicDocument,
	fullUpdateByteLength: number,
): GateDecision {
	const roomMismatch =
		proposal.intent === ProposalIntent.Initialize && candidateDocument.id !== snapshot.roomId;
	if (roomMismatch) {
		const roomId = snapshot.roomId ?? 'a named collaboration room';
		return reject(
			RoomDecisionDiagnosticCode.DocumentRoomMismatch,
			`Document id must match room id ${roomId}`,
			['document', 'id'],
		);
	}

	if (fullUpdateByteLength > CHUNK_BYTES * MAX_CHUNKS) {
		return reject(
			RoomDecisionDiagnosticCode.DocumentTooLarge,
			'Document exceeds the 960 KiB persistable size limit',
			[],
		);
	}
	return { kind: GateDecisionKind.Proceed };
}

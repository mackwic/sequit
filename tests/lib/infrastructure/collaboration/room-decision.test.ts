import { describe, expect, it } from 'vitest';

import {
	CollabMessageKind,
	ProposalIntent,
} from '../../../../src/lib/infrastructure/collaboration/protocol';
import {
	GateDecisionKind,
	postAuthorizationGate,
	preAuthorizationGate,
	RoomDecisionDiagnosticCode,
	type RoomSnapshot,
} from '../../../../src/lib/infrastructure/collaboration/room-decision';
import {
	CHUNK_BYTES,
	MAX_CHUNKS,
} from '../../../../src/lib/infrastructure/collaboration/room-persistence';
import { collaborativeDocument } from '../../../support/builders/collaboration';

const roomId = 'decision-room';

function snapshot(
	commit: number,
	acceptedProposals: ReadonlyMap<string, number> = new Map(),
): RoomSnapshot {
	return { roomId, commit, acceptedProposals };
}

function proposal(intent: ProposalIntent, proposalId = 'proposal-1') {
	return {
		type: CollabMessageKind.Proposal,
		proposalId,
		intent,
		update: new Uint8Array(),
	} as const;
}

describe('room proposal decision gates', () => {
	it('a duplicate change is re-acknowledged with its original commit', () => {
		expect(
			preAuthorizationGate(
				snapshot(2, new Map([['proposal-1', 1]])),
				proposal(ProposalIntent.Change),
			),
		).toEqual({ kind: GateDecisionKind.ReAcknowledge, commit: 1 });
	});

	it('a duplicate initialize is re-acknowledged, not rejected', () => {
		expect(
			preAuthorizationGate(
				snapshot(1, new Map([['proposal-1', 1]])),
				proposal(ProposalIntent.Initialize),
			),
		).toEqual({ kind: GateDecisionKind.ReAcknowledge, commit: 1 });
	});

	it('initialize on an initialized room is rejected', () => {
		expect(preAuthorizationGate(snapshot(1), proposal(ProposalIntent.Initialize))).toMatchObject({
			kind: GateDecisionKind.Reject,
			diagnostics: [{ code: RoomDecisionDiagnosticCode.RoomAlreadyInitialized }],
		});
	});

	it('change on an empty room is rejected', () => {
		expect(preAuthorizationGate(snapshot(0), proposal(ProposalIntent.Change))).toMatchObject({
			kind: GateDecisionKind.Reject,
			diagnostics: [{ code: RoomDecisionDiagnosticCode.RoomNotInitialized }],
		});
	});

	it('initialize on an empty room proceeds', () => {
		expect(preAuthorizationGate(snapshot(0), proposal(ProposalIntent.Initialize))).toEqual({
			kind: GateDecisionKind.Proceed,
		});
	});

	it('change on an initialized room proceeds', () => {
		expect(preAuthorizationGate(snapshot(1), proposal(ProposalIntent.Change))).toEqual({
			kind: GateDecisionKind.Proceed,
		});
	});

	it('initialize with a foreign document id is rejected', () => {
		expect(
			postAuthorizationGate(
				snapshot(0),
				proposal(ProposalIntent.Initialize),
				collaborativeDocument('foreign-room'),
				1,
			),
		).toMatchObject({
			kind: GateDecisionKind.Reject,
			diagnostics: [{ code: RoomDecisionDiagnosticCode.DocumentRoomMismatch }],
		});
	});

	it('initialize without a room name is rejected', () => {
		const unnamed = { ...snapshot(0), roomId: undefined };
		expect(
			postAuthorizationGate(
				unnamed,
				proposal(ProposalIntent.Initialize),
				collaborativeDocument(roomId),
				1,
			),
		).toMatchObject({
			kind: GateDecisionKind.Reject,
			diagnostics: [{ code: RoomDecisionDiagnosticCode.DocumentRoomMismatch }],
		});
	});

	it('a full update above the ceiling is rejected', () => {
		expect(
			postAuthorizationGate(
				snapshot(1),
				proposal(ProposalIntent.Change),
				collaborativeDocument(roomId),
				CHUNK_BYTES * MAX_CHUNKS + 1,
			),
		).toMatchObject({
			kind: GateDecisionKind.Reject,
			diagnostics: [{ code: RoomDecisionDiagnosticCode.DocumentTooLarge }],
		});
	});

	it('a full update at the ceiling proceeds', () => {
		expect(
			postAuthorizationGate(
				snapshot(1),
				proposal(ProposalIntent.Change),
				collaborativeDocument(roomId),
				CHUNK_BYTES * MAX_CHUNKS,
			),
		).toEqual({ kind: GateDecisionKind.Proceed });
	});
});

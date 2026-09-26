import * as Y from 'yjs';

import {
	type ProposalDecision,
	ProposalDecisionKind,
} from './collaborative-document-session-types';
import { ConflictCode } from './session-failure';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	type SessionMessage,
	SessionMessageKind,
} from './session-wire';
import type { TextUpdateBuffer } from './text-update-buffer';

interface Recovery {
	readonly sequence: number;
	readonly document: Y.Doc;
	readonly buffer: TextUpdateBuffer;
	readonly restoring: boolean;
	readonly decision?: ProposalDecision;
	readonly notice: string;
}

function renumberCommands(
	pending: Map<string, Uint8Array>,
	rejectedId: string,
	lastAccepted: number,
): number | undefined {
	if (!pending.delete(rejectedId)) return undefined;
	let sequence = lastAccepted;
	for (const [id, frame] of pending) {
		const command = decodeSessionMessage(frame);
		if (command.type !== SessionMessageKind.Change) continue;
		if (!('commands' in command)) continue;
		sequence++;
		pending.set(id, encodeSessionMessage({ ...command, sequence }));
	}
	return sequence;
}

/** Discard orphan CRDT clocks and rebase only user intentions against the next authoritative sync. */
interface ConflictContext {
	readonly message: Extract<SessionMessage, { type: SessionMessageKind.Conflict }>;
	readonly pending: Map<string, Uint8Array>;
	readonly sequence: number;
	readonly document: Y.Doc;
	readonly buffer: TextUpdateBuffer;
	readonly onUpdate: (update: Uint8Array, origin: unknown) => void;
	readonly createBuffer: () => TextUpdateBuffer;
}

export function recoverSessionConflict(context: ConflictContext): Recovery | undefined {
	const { message, pending, onUpdate, createBuffer } = context;
	let { sequence, document, buffer } = context;
	let decision: ProposalDecision | undefined;
	if (message.id !== undefined && message.lastAcceptedSequence !== undefined) {
		const corrected = renumberCommands(pending, message.id, message.lastAcceptedSequence);
		if (corrected === undefined) return undefined;
		sequence = corrected;
		decision = {
			type: ProposalDecisionKind.Refused,
			proposalId: message.id,
			code: message.code,
			message: message.message,
		};
	}
	let restoring = false;
	if (message.code === ConflictCode.TextTargetGone) {
		buffer.close();
		buffer = createBuffer();
		document.off('update', onUpdate);
		document.destroy();
		document = new Y.Doc();
		document.on('update', onUpdate);
		restoring = true;
	}
	let notice = `Action refusée : ${message.message}`;
	if (restoring)
		notice =
			'La boîte a été supprimée par un autre participant ; votre dernière saisie dans cette boîte n’a pas été enregistrée.';
	const result: {
		sequence: number;
		document: Y.Doc;
		buffer: TextUpdateBuffer;
		restoring: boolean;
		decision?: ProposalDecision;
		notice: string;
	} = { sequence, document, buffer, restoring, notice };
	if (decision !== undefined) result.decision = decision;
	return result;
}

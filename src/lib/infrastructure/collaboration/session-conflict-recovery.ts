import {
	type ProposalDecision,
	ProposalDecisionKind,
} from './collaborative-document-session-types';
import type { PendingCommandFrame } from './session-command-frame';
import { type SessionNotice, SessionNoticeCode } from './session-reasons';
import { type CommandConflictMessage, encodeSessionMessage } from './session-wire';

interface CommandRecovery {
	readonly sequence: number;
	readonly decision: ProposalDecision;
	readonly notice: SessionNotice;
}

/** Preserve later proposal IDs while repairing sequence numbers from the durable receipt. */
export function recoverSessionCommandConflict(
	message: CommandConflictMessage,
	pending: Map<string, PendingCommandFrame>,
): CommandRecovery | undefined {
	if (!pending.delete(message.id)) return undefined;
	let sequence = message.lastAcceptedSequence;
	for (const pendingCommand of pending.values()) {
		sequence++;
		pendingCommand.sequence = sequence;
		pendingCommand.message = { ...pendingCommand.message, sequence };
		pendingCommand.frame = encodeSessionMessage(pendingCommand.message);
	}
	return {
		sequence,
		decision: {
			type: ProposalDecisionKind.Refused,
			proposalId: message.id,
			code: message.code,
			reason: message.reason,
		},
		notice: { code: SessionNoticeCode.ActionRefused, id: message.id, reason: message.reason },
	};
}

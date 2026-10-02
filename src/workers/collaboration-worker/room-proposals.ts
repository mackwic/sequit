import * as Y from 'yjs';

import { authorizeProposal } from '../../lib/infrastructure/collaboration/authorize-proposal';
import {
	BusinessCommandRefusal,
	TerminalSessionFailure,
} from '../../lib/infrastructure/collaboration/session-failure';
import { SessionFailureCode } from '../../lib/infrastructure/collaboration/session-reasons';
import {
	type IdentifiedTextMessage,
	type SessionMessage,
	SessionMessageKind,
} from '../../lib/infrastructure/collaboration/session-wire';
import { executeSharedCommands } from '../../lib/infrastructure/collaboration/shared-command-executor';
import {
	assertKnownTextDeletions,
	assertTextStructParents,
} from '../../lib/infrastructure/collaboration/text-parent-validation';
import {
	assertSyntacticTextProposal,
	isLiveTextTarget,
} from '../../lib/infrastructure/collaboration/text-update-validation';
import { defaultUpdateGuards } from '../../lib/infrastructure/collaboration/update-guards';
import { upgradeSharedTexts } from '../../lib/infrastructure/collaboration/upgrade-shared-texts';
import { readLogicDocument } from '../../lib/infrastructure/collaboration/yjs-document-codec';
import { commandConflictCode, refuseTextTarget } from './room-failures';
import type { RoomRefusalBudget } from './room-refusal-budget';
import { sendRoomMessage } from './room-sockets';
import type { RoomState } from './room-storage';

function invalidDocument(details: readonly string[]): TerminalSessionFailure {
	return new TerminalSessionFailure(SessionFailureCode.InvalidDocument, {
		code: SessionFailureCode.InvalidDocument,
		details,
	});
}

export type InitializeMessage = Extract<SessionMessage, { type: SessionMessageKind.Initialize }>;
export type CommandsMessage = Extract<SessionMessage, { readonly commands: unknown }>;
/** What every proposal is judged against: the authoritative state, its sender and the refusal budget. */
export interface ProposalContext {
	readonly state: RoomState;
	readonly socket: WebSocket;
	readonly budget: RoomRefusalBudget;
}

export type TextChangeMessage = Extract<
	SessionMessage,
	{ readonly update: Uint8Array; readonly type: SessionMessageKind.Change }
>;

/** Each authorizer returns the candidate document to commit; the caller destroys it. */
export async function authorizeInitialization(
	state: RoomState,
	roomId: string | undefined,
	message: InitializeMessage,
): Promise<Y.Doc> {
	const result = await authorizeProposal({
		proposalId: message.id,
		authoritative: state.doc,
		acceptedDocument: undefined,
		proposedUpdate: message.update,
		guards: defaultUpdateGuards,
	});
	if (!result.ok) throw invalidDocument(result.diagnostics.map(({ message }) => message));
	if (result.value.candidateDocument.id !== roomId) {
		result.value.candidate.destroy();
		throw invalidDocument(['Document ID does not match the room.']);
	}
	upgradeSharedTexts(result.value.candidate);
	return result.value.candidate;
}

/** Applies the commands on a copy; a business refusal answers the socket and yields nothing. */
export function authorizeCommands(
	{ state, socket, budget }: ProposalContext,
	message: CommandsMessage,
	acceptedSequence: number,
): Y.Doc | undefined {
	if (state.commit === 0) throw invalidDocument(['Document must be initialized before commands.']);
	const candidate = new Y.Doc({ gc: false });
	Y.applyUpdate(candidate, Y.encodeStateAsUpdate(state.doc));
	try {
		executeSharedCommands(candidate, message.commands);
		return candidate;
	} catch (error) {
		candidate.destroy();
		if (!(error instanceof BusinessCommandRefusal)) throw error;
		if (!budget.allow(socket, message.id))
			throw new TerminalSessionFailure(SessionFailureCode.RepeatedCommandRefusal, {
				code: SessionFailureCode.RepeatedCommandRefusal,
			});
		sendRoomMessage(socket, {
			type: SessionMessageKind.Conflict,
			code: commandConflictCode(error),
			reason: error.reason,
			id: message.id,
			lastAcceptedSequence: acceptedSequence,
		});
		return undefined;
	}
}

/** Text syncs and identified text proposals; a gone target or an empty update yields nothing. */
export async function authorizeTextUpdate(
	{ state, socket, budget }: ProposalContext,
	update: Uint8Array,
	message: TextChangeMessage | undefined,
): Promise<Y.Doc | undefined> {
	const decoded = Y.decodeUpdate(update);
	const empty = decoded.structs.length === 0 && decoded.ds.clients.size === 0;
	let textTarget: IdentifiedTextMessage | undefined;
	if (message?.id !== undefined) {
		textTarget = message;
		assertSyntacticTextProposal(message, decoded);
		if (!isLiveTextTarget(state.doc, message)) {
			assertTextStructParents(state.doc, message, decoded.structs);
			assertKnownTextDeletions(state.doc, message, decoded.ds.clients);
			refuseTextTarget(socket, message, budget);
			return undefined;
		}
	}
	if (empty) return undefined;
	const accepted = readLogicDocument(state.doc);
	if (!accepted.ok) throw invalidDocument(['Document must be initialized before text updates.']);
	const result = await authorizeProposal({
		authoritative: state.doc,
		acceptedDocument: accepted.value,
		proposedUpdate: update,
		guards: defaultUpdateGuards,
		textOnly: true,
		textTarget,
	});
	if (!result.ok) throw invalidDocument(result.diagnostics.map(({ message }) => message));
	return result.value.candidate;
}

import type * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import type { DocumentCommandOutcome } from '../document/document-command-contracts';
import type { DocumentSessionSubscriber } from '../document/document-session-contracts';
import type { SharedDocumentCommand, SharedTarget } from '../document/shared-document-command';
import type { ConflictCode } from './session-failure';
import type { LocalPresence, ParticipantPresence } from './session-wire';
import type { SourceDocumentState } from './source-document-state';

export { type SourceDocumentState, SourceDocumentStateKind } from './source-document-state';

export enum CollaborationStatus {
	Connecting = 'connecting',
	Synchronizing = 'synchronizing',
	Ready = 'ready',
	Disconnected = 'disconnected',
}

export enum ProposalDecisionKind {
	Accepted = 'accepted',
	Refused = 'refused',
}

interface AcceptedProposalDecision {
	readonly type: ProposalDecisionKind.Accepted;
	readonly proposalId: string;
	readonly commit: number;
}

interface RefusedProposalDecision {
	readonly type: ProposalDecisionKind.Refused;
	readonly proposalId: string;
	readonly code: ConflictCode;
	readonly message: string;
}

export type ProposalDecision = AcceptedProposalDecision | RefusedProposalDecision;

/**
 * One vocabulary of structural commands and one executor serve every session. The local session
 * runs `executeSharedCommands` in process; the collaborative session lets the room run it.
 * Text fields are edited through their stable `Y.Text`, never through a command.
 */
export interface DocumentSession {
	read(): LogicDocument;
	readSourceState(): SourceDocumentState;
	subscribe(listener: DocumentSessionSubscriber): () => void;
	subscribeToSourceState(listener: (state: SourceDocumentState) => void): () => void;
	/**
	 * Proposes one atomic batch and resolves with its decision: the whole batch is accepted, or
	 * refused with diagnostics and the document is unchanged. Throws synchronously when the session
	 * cannot accept commands (destroyed, or collaboratively not connected).
	 */
	dispatch(commands: readonly SharedDocumentCommand[]): Promise<DocumentCommandOutcome>;
	text(target: SharedTarget, field: string): Y.Text | undefined;
	/** Returns false when the target is gone or text is not editable right now. */
	updateText(target: SharedTarget, field: string, next: string, bound?: Y.Text): boolean;
	replaceNodeMarkdown(nodeId: string, markdown: string): boolean;
	destroy(): void;
}

export interface CollaborativeDocumentSession extends DocumentSession {
	readonly document: Y.Doc;
	replica(): number;
	subscribeToConflict(listener: (message: string) => void): () => void;
	applyLocalTextUpdate(
		target: SharedTarget,
		field: string,
		update: Uint8Array,
		bound?: Y.Text,
	): void;
	setPresence(presence: Partial<LocalPresence>): void;
	subscribeToPresence(listener: (participants: readonly ParticipantPresence[]) => void): () => void;
	subscribeToRejection(listener: (message: string) => void): () => void;
	connectionStatus(): CollaborationStatus;
	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void;
}

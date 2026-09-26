import type * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
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

export interface AcceptedProposalDecision {
	readonly type: ProposalDecisionKind.Accepted;
	readonly proposalId: string;
	readonly commit: number;
}

export interface RefusedProposalDecision {
	readonly type: ProposalDecisionKind.Refused;
	readonly proposalId: string;
	readonly code: ConflictCode;
	readonly message: string;
}

export type ProposalDecision = AcceptedProposalDecision | RefusedProposalDecision;

export interface CollaborativeDocumentSession {
	readonly document: Y.Doc;
	subscribeToConflict(listener: (message: string) => void): () => void;
	applyLocalTextUpdate(target: SharedTarget, field: string, update: Uint8Array): void;
	dispatch(commands: readonly SharedDocumentCommand[]): string;
	text(target: SharedTarget, field: string): Y.Text | undefined;
	updateText(target: SharedTarget, field: string, next: string): boolean;
	setPresence(presence: Partial<LocalPresence>): void;
	subscribeToPresence(listener: (participants: readonly ParticipantPresence[]) => void): () => void;
	subscribeToRejection(listener: (message: string) => void): () => void;
	read(): LogicDocument;
	readSourceState(): SourceDocumentState;
	subscribe(listener: DocumentSessionSubscriber): () => void;
	subscribeToSourceState(listener: (state: SourceDocumentState) => void): () => void;
	replaceNodeMarkdown(nodeId: string, markdown: string): boolean;
	connectionStatus(): CollaborationStatus;
	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void;
	destroy(): void;
}

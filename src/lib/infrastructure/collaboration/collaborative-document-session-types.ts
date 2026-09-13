import type * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import type { DocumentSessionSubscriber } from '../document/document-session-contracts';
import type { SharedDocumentCommand, SharedTarget } from '../document/shared-document-command';
import type { LocalPresence, ParticipantPresence } from './session-wire';

export enum CollaborationStatus {
	Connecting = 'connecting',
	Synchronizing = 'synchronizing',
	Ready = 'ready',
	Disconnected = 'disconnected',
}

export enum ProposalDecisionKind {
	Accepted = 'accepted',
}

export interface ProposalDecision {
	readonly type: ProposalDecisionKind.Accepted;
	readonly proposalId: string;
	readonly commit: number;
}

export interface CollaborativeDocumentSession {
	readonly document: Y.Doc;
	applyLocalTextUpdate(update: Uint8Array): void;
	dispatch(commands: readonly SharedDocumentCommand[]): string;
	text(target: SharedTarget, field: string): Y.Text | undefined;
	updateText(target: SharedTarget, field: string, next: string): boolean;
	setPresence(presence: LocalPresence): void;
	subscribeToPresence(listener: (participants: readonly ParticipantPresence[]) => void): () => void;
	subscribeToRejection(listener: (message: string) => void): () => void;
	read(): LogicDocument;
	subscribe(listener: DocumentSessionSubscriber): () => void;
	replaceNodeMarkdown(nodeId: string, markdown: string): boolean;
	connectionStatus(): CollaborationStatus;
	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void;
	destroy(): void;
}

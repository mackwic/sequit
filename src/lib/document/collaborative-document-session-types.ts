import type { ProtocolDiagnostic } from '../collaboration/protocol';
import type { DocumentSessionSubscriber } from './document-session';
import type { LogicDocument } from './logic-document';

export enum CollaborationStatus {
	Connecting = 'connecting',
	Synchronizing = 'synchronizing',
	Ready = 'ready',
	Disconnected = 'disconnected',
}

export enum ProposalDecisionKind {
	Accepted = 'accepted',
	Rejected = 'rejected',
	OperationDropped = 'operation-dropped',
}

export enum OperationDropReason {
	StaleTarget = 'stale-target',
}

export enum CollaborativeSessionDiagnosticCode {
	StaleOperationTarget = 'stale-operation-target',
}

interface AcceptedDecision {
	readonly type: ProposalDecisionKind.Accepted;
	readonly proposalId?: string;
	readonly commit: number;
}

interface RejectedDecision {
	readonly type: ProposalDecisionKind.Rejected;
	readonly proposalId: string;
	readonly diagnostics: readonly ProtocolDiagnostic[];
}

interface OperationDroppedDecision {
	readonly type: ProposalDecisionKind.OperationDropped;
	readonly reason: OperationDropReason.StaleTarget;
	readonly diagnostics: readonly ProtocolDiagnostic[];
}

export type ProposalDecision = AcceptedDecision | RejectedDecision | OperationDroppedDecision;

export interface CollaborativeDocumentSession {
	read(): LogicDocument;
	subscribe(listener: DocumentSessionSubscriber): () => void;
	replaceNodeMarkdown(nodeId: string, markdown: string): boolean;
	connectionStatus(): CollaborationStatus;
	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void;
	destroy(): void;
}

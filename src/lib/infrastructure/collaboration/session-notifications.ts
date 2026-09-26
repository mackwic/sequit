import type { LogicDocument } from '../../core/document/logic-document';
import type { DocumentSessionSubscriber } from '../document/document-session-contracts';
import type { ProposalDecision, SourceDocumentState } from './collaborative-document-session-types';
import { subscribeToSet } from './notify-subscribers';

/** Keeps listeners alive across an in-place replica replacement. */
export class SessionNotifications {
	protected readonly subscribers = new Set<DocumentSessionSubscriber>();
	protected readonly sourceStateListeners = new Set<(state: SourceDocumentState) => void>();
	protected readonly decisionListeners = new Set<(decision: ProposalDecision) => void>();
	protected readonly rejectionListeners = new Set<(message: string) => void>();
	protected readonly conflictListeners = new Set<(message: string) => void>();

	subscribe(listener: (document: LogicDocument) => void): () => void {
		return subscribeToSet(this.subscribers, listener);
	}

	subscribeToSourceState(listener: (state: SourceDocumentState) => void): () => void {
		return subscribeToSet(this.sourceStateListeners, listener);
	}

	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void {
		return subscribeToSet(this.decisionListeners, listener);
	}

	subscribeToRejection(listener: (message: string) => void): () => void {
		return subscribeToSet(this.rejectionListeners, listener);
	}

	subscribeToConflict(listener: (message: string) => void): () => void {
		return subscribeToSet(this.conflictListeners, listener);
	}

	protected clearNotifications(): void {
		this.subscribers.clear();
		this.sourceStateListeners.clear();
		this.decisionListeners.clear();
		this.rejectionListeners.clear();
		this.conflictListeners.clear();
	}
}

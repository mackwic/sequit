import type { LogicDocument } from '../../core/document/logic-document';
import {
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
	sessionClosedOutcome,
} from '../document/document-command-contracts';
import type { DocumentSessionSubscriber } from '../document/document-session-contracts';
import {
	type ProposalDecision,
	ProposalDecisionKind,
	type SourceDocumentState,
} from './collaborative-document-session-types';
import { notifySubscribers, subscribeToSet } from './notify-subscribers';
import type { PendingCommandFrame } from './session-command-frame';
import type { SessionNotice, SessionRejection } from './session-reasons';

function decisionOutcome(
	decision: ProposalDecision,
	read: () => LogicDocument,
): DocumentCommandOutcome {
	if (decision.type === ProposalDecisionKind.Accepted)
		return { kind: DocumentCommandOutcomeKind.Accepted, document: read() };
	return {
		kind: DocumentCommandOutcomeKind.Rejected,
		diagnostics: [
			{ code: decision.code, message: decision.reason.code, reason: decision.reason, path: [] },
		],
	};
}

/** Keeps listeners and undecided proposals alive across an in-place replica replacement. */
export abstract class SessionNotifications {
	protected readonly subscribers = new Set<DocumentSessionSubscriber>();
	protected readonly sourceStateListeners = new Set<(state: SourceDocumentState) => void>();
	protected readonly decisionListeners = new Set<(decision: ProposalDecision) => void>();
	protected readonly rejectionListeners = new Set<
		(reason: SessionRejection | SessionNotice) => void
	>();
	protected readonly conflictListeners = new Set<(notice: SessionNotice) => void>();
	/** Structural proposals sent to the room and not yet decided, in sequence order. */
	protected readonly pending = new Map<string, PendingCommandFrame>();
	readonly #outcomes = new Map<string, (outcome: DocumentCommandOutcome) => void>();

	abstract read(): LogicDocument;

	subscribe(listener: (document: LogicDocument) => void): () => void {
		return subscribeToSet(this.subscribers, listener);
	}

	subscribeToSourceState(listener: (state: SourceDocumentState) => void): () => void {
		return subscribeToSet(this.sourceStateListeners, listener);
	}

	subscribeToDecisions(listener: (decision: ProposalDecision) => void): () => void {
		return subscribeToSet(this.decisionListeners, listener);
	}

	subscribeToRejection(listener: (reason: SessionRejection | SessionNotice) => void): () => void {
		return subscribeToSet(this.rejectionListeners, listener);
	}

	subscribeToConflict(listener: (notice: SessionNotice) => void): () => void {
		return subscribeToSet(this.conflictListeners, listener);
	}

	/** The returned promise settles with the room's decision on the proposal, or on session close. */
	protected propose(proposal: PendingCommandFrame): Promise<DocumentCommandOutcome> {
		this.pending.set(proposal.id, proposal);
		return new Promise((resolve) => {
			this.#outcomes.set(proposal.id, resolve);
		});
	}

	protected announceAccepted(proposalId: string, commit: number): void {
		this.announceDecision({ type: ProposalDecisionKind.Accepted, proposalId, commit });
	}

	/**
	 * Notifies decision listeners and settles the proposal's dispatch. The outcome is captured
	 * first so a listener that closes the session cannot change or break it.
	 */
	protected announceDecision(decision: ProposalDecision): void {
		const settle = this.#outcomes.get(decision.proposalId);
		this.#outcomes.delete(decision.proposalId);
		if (settle === undefined) {
			notifySubscribers(this.decisionListeners, decision);
			return;
		}
		const outcome = decisionOutcome(decision, () => this.read());
		notifySubscribers(this.decisionListeners, decision);
		settle(outcome);
	}

	/** A closed session never decides its pending proposals: their dispatches must not hang. */
	protected closeProposals(): void {
		this.pending.clear();
		const unsettled = [...this.#outcomes.values()];
		this.#outcomes.clear();
		for (const settle of unsettled) settle(sessionClosedOutcome());
	}

	protected clearNotifications(): void {
		this.subscribers.clear();
		this.sourceStateListeners.clear();
		this.decisionListeners.clear();
		this.rejectionListeners.clear();
		this.conflictListeners.clear();
	}
}

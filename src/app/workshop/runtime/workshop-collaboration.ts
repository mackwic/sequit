import {
	CollaborationStatus,
	type CollaborativeDocumentSession,
	ProposalDecisionKind,
} from '../../../lib/infrastructure/collaboration/collaborative-document-session';
import {
	type DocumentCommandOutcome,
	DocumentCommandOutcomeKind,
} from '../../../lib/infrastructure/document/document-command-contracts';
import type { WorkshopTransport } from './workshop-transport';

function failed(message: string): DocumentCommandOutcome {
	return { kind: DocumentCommandOutcomeKind.Failed, error: new Error(message) };
}

/** One outstanding command per editor. Wire events run after the client's listeners,
 * so status reflects the completed handshake without polling or optimistic acknowledgements. */
export class WorkshopCollaboration {
	private pending: ((result: DocumentCommandOutcome) => void) | undefined;
	private initialized = false;
	private destroyed = false;
	private readonly listeners = new Set<(status: CollaborationStatus) => void>();
	private readonly cleanup: readonly (() => void)[];
	constructor(
		private readonly client: CollaborativeDocumentSession,
		transport: WorkshopTransport,
	) {
		const update = (): void => {
			const status = client.connectionStatus();
			if (status === CollaborationStatus.Ready) this.initialized = true;
			for (const listener of this.listeners) listener(status);
		};
		this.cleanup = [
			transport.subscribeToFrames(update),
			transport.subscribeToStatus(update),
			client.subscribeToDecisions((decision) => {
				const resolve = this.pending;
				if (resolve === undefined) return;
				this.pending = undefined;
				if (decision.type === ProposalDecisionKind.Accepted)
					resolve({ kind: DocumentCommandOutcomeKind.Accepted, document: client.read() });
				else
					resolve({ kind: DocumentCommandOutcomeKind.Rejected, diagnostics: decision.diagnostics });
			}),
		];
		update();
	}
	status(): CollaborationStatus {
		return this.client.connectionStatus();
	}
	canPause(): boolean {
		return this.initialized;
	}
	subscribeToStatus(listener: (status: CollaborationStatus) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	replaceNodeMarkdown(id: string, markdown: string): Promise<DocumentCommandOutcome> {
		if (this.destroyed || !this.initialized)
			return Promise.resolve(failed('Attends la première synchronisation.'));
		if (this.pending !== undefined)
			return Promise.resolve(
				failed(
					'Une modification attend encore sa validation. Reconnecte la session pour terminer cet envoi.',
				),
			);
		return new Promise((resolve) => {
			this.pending = resolve;
			try {
				if (this.client.replaceNodeMarkdown(id, markdown)) return;
				this.pending = undefined;
				resolve(failed('Boîte indisponible.'));
			} catch (error) {
				this.pending = undefined;
				resolve({ kind: DocumentCommandOutcomeKind.Failed, error });
			}
		});
	}
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const stop of this.cleanup) stop();
		this.pending?.(failed('Séance terminée.'));
		this.pending = undefined;
		this.listeners.clear();
		this.client.destroy();
	}
}

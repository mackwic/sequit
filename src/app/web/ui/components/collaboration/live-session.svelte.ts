import type { LogicDocument } from '../../../../../lib/core/document/logic-document';
import type { CollaborationTransport } from '../../../../../lib/infrastructure/collaboration/collaboration-transport';
import {
	CollaborationStatus,
	type CollaborativeDocumentSession,
	createCollaborativeDocumentSession,
} from '../../../../../lib/infrastructure/collaboration/collaborative-document-session';
import type { ParticipantPresence } from '../../../../../lib/infrastructure/collaboration/participant-presence';
import { textEditable } from '../../../../../lib/infrastructure/collaboration/session-connection-status';
import { refreshRejectedSession } from '../../../document/collaboration-rejection';
import { CollaborationAwareness } from './collaboration-awareness.svelte';

/** One collaborative session and the reactive state a page needs to render it. */
export class LiveSession {
	readonly client: CollaborativeDocumentSession;
	/** Other participants' presence and the follow target, shared by the page and the canvas. */
	readonly awareness: CollaborationAwareness;
	model = $state.raw<LogicDocument>();
	status = $state(CollaborationStatus.Connecting);
	initialized = $state(false);
	replica = $state(0);
	participants = $state<readonly ParticipantPresence[]>([]);
	/** The last conflict message, until the page dismisses it. */
	conflict = $state<string>();
	readonly #stops: readonly (() => void)[];

	constructor(initialDocument: LogicDocument, transport: CollaborationTransport) {
		const client = createCollaborativeDocumentSession(initialDocument, transport);
		this.client = client;
		this.awareness = new CollaborationAwareness(client);
		const refresh = (): void => {
			if (this.replica !== client.replica()) {
				this.replica = client.replica();
				this.model = undefined;
				this.initialized = false;
			}
			this.status = client.connectionStatus();
			if (this.status === CollaborationStatus.Ready) {
				this.model ??= client.read();
				this.initialized = true;
			}
		};
		this.#stops = [
			client.subscribe((value) => {
				this.model = value;
			}),
			client.subscribeToRejection(refreshRejectedSession),
			client.subscribeToConflict((message) => {
				this.conflict = message;
				refresh();
			}),
			client.subscribeToSourceState(refresh),
			client.subscribeToPresence((value) => {
				this.participants = value;
			}),
			transport.subscribeToFrames(refresh),
			transport.subscribeToStatus(refresh),
		];
	}

	get connected(): boolean {
		return this.status === CollaborationStatus.Ready;
	}

	get textEditable(): boolean {
		return textEditable(this.status, this.initialized);
	}

	destroy(): void {
		for (const stop of this.#stops) stop();
		this.awareness.destroy();
		this.client.destroy();
	}
}

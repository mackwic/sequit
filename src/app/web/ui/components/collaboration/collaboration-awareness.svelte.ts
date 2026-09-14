import { createContext } from 'svelte';

import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
import type {
	ParticipantPresence,
	TextSelectionPresence,
} from '../../../../../lib/infrastructure/collaboration/participant-presence';

/** One presence subscription shared by every editor and the canvas in this workspace. */
export class CollaborationAwareness {
	participants = $state<readonly ParticipantPresence[]>([]);
	readonly #stop: () => void;
	#editor: symbol | undefined;

	constructor(readonly client: CollaborativeDocumentSession) {
		this.#stop = client.subscribeToPresence((participants) => {
			this.participants = participants.filter(
				({ clientId }) => clientId !== client.document.clientID,
			);
		});
	}

	textSelection(owner: symbol, selection: TextSelectionPresence | null): void {
		if (selection === null && this.#editor !== owner) return;
		this.#editor = undefined;
		if (selection !== null) this.#editor = owner;
		this.client.setPresence({ textSelection: selection });
	}

	destroy(): void {
		this.#stop();
	}
}

export const [getCollaborationAwareness, setCollaborationAwareness] =
	createContext<CollaborationAwareness>();

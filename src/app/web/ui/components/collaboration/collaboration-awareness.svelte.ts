import { createContext } from 'svelte';

import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
import type {
	ParticipantPresence,
	TextSelectionPresence,
} from '../../../../../lib/infrastructure/collaboration/participant-presence';

/** One presence subscription shared by every editor and the canvas in this workspace. */
export class CollaborationAwareness {
	/** Everyone but this client. */
	participants = $state<readonly ParticipantPresence[]>([]);
	/** The participant whose pointer or selection keeps the viewport centred, if any. */
	following = $state<number>();
	readonly #stop: () => void;
	#editor: symbol | undefined;

	constructor(readonly client: CollaborativeDocumentSession) {
		this.#stop = client.subscribeToPresence((participants) => {
			this.participants = participants.filter(
				({ clientId }) => clientId !== client.document.clientID,
			);
			if (this.following !== undefined && !this.participants.some(this.#isFollowed))
				this.following = undefined;
		});
	}

	readonly #isFollowed = ({ clientId }: ParticipantPresence): boolean =>
		clientId === this.following;

	/** Toggles following `clientId`; following someone else replaces the previous target. */
	follow(clientId: number): void {
		if (this.following === clientId) this.following = undefined;
		else this.following = clientId;
	}

	unfollow(): void {
		this.following = undefined;
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

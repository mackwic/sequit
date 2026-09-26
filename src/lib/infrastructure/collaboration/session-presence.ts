import { notifySubscribers, subscribeToSet } from './notify-subscribers';
import { clearSessionTimer, sendPresenceSafely } from './session-incoming';
import type { LocalPresence, ParticipantPresence, SessionMessage } from './session-wire';

/** Presence is ephemeral and never affects durable commands. */
export class SessionPresence {
	readonly #listeners = new Set<(participants: readonly ParticipantPresence[]) => void>();
	#local: ParticipantPresence | undefined;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#participants: readonly ParticipantPresence[] = [];

	constructor(
		private readonly clientId: () => number,
		private readonly sendFrame: (message: SessionMessage) => void,
	) {}

	subscribe(listener: (participants: readonly ParticipantPresence[]) => void): () => void {
		const stop = subscribeToSet(this.#listeners, listener);
		notifySubscribers([listener], this.#participants);
		return stop;
	}

	update(presence: Partial<LocalPresence>): void {
		this.#local = {
			name: 'Participant',
			color: '#6f70e8',
			selected: [],
			...this.#local,
			...presence,
			clientId: this.clientId(),
		};
		this.#timer ??= setTimeout(() => {
			this.send();
		}, 50);
	}

	send(): void {
		this.stop();
		sendPresenceSafely(this.#local, this.sendFrame);
	}

	receive(participants: readonly ParticipantPresence[]): void {
		this.#participants = participants;
		notifySubscribers(this.#listeners, participants);
	}

	stop(): void {
		this.#timer = clearSessionTimer(this.#timer);
	}

	destroy(): void {
		this.stop();
		this.#listeners.clear();
	}
}

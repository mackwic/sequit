import * as Y from 'yjs';

import { type SessionMessage, SessionMessageKind } from './session-wire';
import { readSyncStep, SyncStepKind, writeSyncRequest, writeSyncResponse } from './sync-steps';
import type { TextIntentLedger } from './text-intent-ledger';
import type { TextUpdateBuffer } from './text-update-buffer';

interface SyncHost {
	readonly document: () => Y.Doc;
	readonly initialized: () => boolean;
	readonly restoring: () => boolean;
	readonly intents: TextIntentLedger;
	readonly buffer: () => TextUpdateBuffer;
	readonly pending: ReadonlyMap<string, Uint8Array>;
	readonly send: (message: SessionMessage) => void;
	readonly replay: (frame: Uint8Array) => void;
	readonly initialize: () => void;
	readonly clearInitialization: () => void;
	readonly setRestoring: (value: boolean) => void;
	readonly setReady: (value: boolean) => void;
	readonly notifyDraft: (message: string) => void;
	readonly terminal: (message: string) => void;
	readonly presence: () => void;
}

/** Owns retry deadlines and native Yjs sync without retaining discarded replica clocks. */
export class SessionSynchronizer {
	#timer: ReturnType<typeof setTimeout> | null = null;
	#attempts = 0;

	constructor(private readonly host: SyncHost) {}

	get attempts(): number {
		return this.#attempts;
	}

	acknowledge(): void {
		this.#attempts = 0;
	}

	stop(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	start(): void {
		this.stop();
		this.host.send({
			type: SessionMessageKind.Sync,
			payload: writeSyncRequest(this.host.document()),
		});
		this.host.presence();
	}

	retry(message: string): void {
		this.#attempts++;
		if (this.#attempts > 3) {
			this.host.terminal(`La synchronisation a échoué plusieurs fois : ${message}`);
			return;
		}
		this.host.setReady(false);
		this.#timer ??= setTimeout(() => {
			this.start();
		}, 1_000);
	}

	receive(payload: Uint8Array): void {
		const document = this.host.document();
		const step = readSyncStep(payload);
		if (step.kind === SyncStepKind.Response) {
			Y.applyUpdate(document, step.update);
			if (this.host.restoring()) {
				this.host.intents.restore(document, this.host.notifyDraft);
				this.host.setRestoring(false);
			}
			return;
		}
		this.host.send({
			type: SessionMessageKind.Sync,
			payload: writeSyncResponse(document, step.stateVector),
		});
		if (!this.host.initialized()) this.host.initialize();
		else this.host.clearInitialization();
		for (const frame of this.host.pending.values()) this.host.replay(frame);
		const ready = this.host.initialized();
		this.host.setReady(ready);
		if (ready) this.host.buffer().flush();
	}
}

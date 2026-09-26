import * as Y from 'yjs';

import type { PendingCommandFrame } from './session-command-frame';
import { type SessionMessage, SessionMessageKind } from './session-wire';
import { readSyncStep, SyncStepKind, writeSyncRequest, writeSyncResponse } from './sync-steps';
import type { TextUpdateBuffer } from './text-update-buffer';

const MAX_RETRY_ATTEMPTS = 6;
const MAX_RETRY_DELAY_MS = 16_000;

interface SyncHost {
	readonly document: () => Y.Doc;
	readonly initialized: () => boolean;
	readonly buffer: () => TextUpdateBuffer;
	readonly pending: ReadonlyMap<string, PendingCommandFrame>;
	readonly send: (message: SessionMessage) => void;
	readonly replay: (frame: Uint8Array) => void;
	readonly initialize: () => void;
	readonly clearInitialization: () => void;
	readonly setReady: (value: boolean) => void;
	readonly terminal: (message: string) => void;
	readonly presence: () => void;
	readonly resumeText: () => boolean;
}

/** Owns retry deadlines and native Yjs sync against one persistent replica. */
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
		if (this.#attempts > MAX_RETRY_ATTEMPTS) {
			this.host.terminal(`La synchronisation a échoué plusieurs fois : ${message}`);
			return;
		}
		this.host.setReady(false);
		const exponential = 1_000 * 2 ** (this.#attempts - 1);
		const jitter = 0.75 + Math.random() * 0.5;
		const delay = Math.min(MAX_RETRY_DELAY_MS, Math.round(exponential * jitter));
		this.#timer ??= setTimeout(() => {
			this.stop();
			if (!this.host.resumeText()) this.start();
		}, delay);
	}

	receive(payload: Uint8Array): void {
		const document = this.host.document();
		const step = readSyncStep(payload);
		if (step.kind === SyncStepKind.Response) {
			Y.applyUpdate(document, step.update);
			return;
		}
		this.host.send({
			type: SessionMessageKind.Sync,
			payload: writeSyncResponse(document, step.stateVector),
		});
		if (!this.host.initialized()) this.host.initialize();
		else this.host.clearInitialization();
		for (const pending of this.host.pending.values()) this.host.replay(pending.frame);
		const ready = this.host.initialized();
		this.host.setReady(ready);
		if (ready) this.host.buffer().flush();
	}
}

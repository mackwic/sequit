import type * as Y from 'yjs';

import { SharedElementKind, type SharedTarget } from '../document/shared-document-command';
import { notifySubscribers } from './notify-subscribers';
import { type SessionNotice, SessionNoticeCode } from './session-reasons';
import {
	type IdentifiedTextMessage,
	SessionMessageKind,
	type TextTargetReference,
} from './session-wire';
import { TextUpdateBuffer } from './text-update-buffer';

interface EditedTarget {
	readonly target: SharedTarget;
	readonly version: number;
}

/** Tracks pending user gestures, never replays text or rewrites Yjs history. */
class SessionTextEdits {
	readonly #active = new Map<string, EditedTarget>();
	readonly #sent = new Map<string, Map<string, number>>();
	#version = 0;
	#lastSentVersion = 0;

	record(target: SharedTarget, field: string): void {
		this.#active.set(`${target.kind}:${target.id}:${field}`, { target, version: ++this.#version });
	}

	sent(id: string): void {
		const snapshot = new Map<string, number>();
		for (const [key, value] of this.#active)
			if (value.version > this.#lastSentVersion) snapshot.set(key, value.version);
		this.#sent.set(id, snapshot);
		this.#lastSentVersion = this.#version;
	}

	acknowledge(id: string): boolean {
		const snapshot = this.#sent.get(id);
		if (snapshot === undefined) return false;
		this.#sent.delete(id);
		for (const [key, version] of snapshot)
			if (this.#active.get(key)?.version === version) this.#active.delete(key);
		return true;
	}

	pendingNodeIds(): ReadonlySet<string> {
		const ids = new Set<string>();
		for (const { target } of this.#active.values())
			if (target.kind === SharedElementKind.Node) ids.add(target.id);
		return ids;
	}

	clear(): void {
		this.#active.clear();
		this.#sent.clear();
	}
}

function sameTextTarget(
	previous: TextTargetReference,
	target: SharedTarget,
	field: string,
	id: Y.ID,
): boolean {
	if (previous.target.kind !== target.kind) return false;
	if (previous.target.id !== target.id) return false;
	if (previous.field !== field) return false;
	if (previous.textId.client !== id.client) return false;
	return previous.textId.clock === id.clock;
}

function abandonedTextNotice(target: SharedTarget): SessionNotice {
	return { code: SessionNoticeCode.UnsentTextAbandoned, target };
}

/** One proposal holds edits to exactly one integrated Y.Text; frames survive disconnects. */
export class SessionTextFlow {
	readonly edits = new SessionTextEdits();
	readonly pending = new Map<string, IdentifiedTextMessage>();
	readonly buffer: TextUpdateBuffer;
	readonly #send: (message: IdentifiedTextMessage) => void;
	readonly #abandoned: Iterable<(notice: SessionNotice) => void>;
	readonly #reported = new WeakSet<Y.Text>();
	#target: TextTargetReference | undefined;

	constructor(
		sessionId: string,
		ready: () => boolean,
		send: (message: IdentifiedTextMessage) => void,
		abandoned: Iterable<(notice: SessionNotice) => void>,
	) {
		this.#send = send;
		this.#abandoned = abandoned;
		this.buffer = new TextUpdateBuffer((update) => {
			const reference = this.#target;
			if (reference === undefined) throw new Error('A text update has no target');
			const message: IdentifiedTextMessage = {
				type: SessionMessageKind.Change,
				id: crypto.randomUUID(),
				sessionId,
				update,
				...reference,
			};
			this.pending.set(message.id, message);
			this.edits.sent(message.id);
			if (ready() && this.pending.size === 1) this.#send(message);
		});
	}

	boundText(
		target: SharedTarget,
		current: Y.Text | undefined,
		expected?: Y.Text,
	): current is Y.Text {
		if (expected === undefined) return current !== undefined;
		if (current === expected) return true;
		if (!this.#reported.has(expected)) {
			this.#reported.add(expected);
			notifySubscribers(this.#abandoned, abandonedTextNotice(target));
		}
		return false;
	}

	prepare(target: SharedTarget, field: string, text: Y.Text): void {
		const id = text._item?.id;
		if (id === undefined) throw new Error('Shared text must be attached to the document');
		const previous = this.#target;
		if (previous !== undefined && !sameTextTarget(previous, target, field, id)) this.buffer.flush();
		this.#target = { target, field, textId: { client: id.client, clock: id.clock } };
		this.edits.record(target, field);
	}

	resume(): boolean {
		this.buffer.flush();
		return this.sendNext();
	}

	sendNext(): boolean {
		const next = this.pending.values().next().value;
		if (next === undefined) return false;
		this.#send(next);
		return true;
	}

	discardedNodeIds(): ReadonlySet<string> {
		const ids = new Set(this.edits.pendingNodeIds());
		for (const { target } of this.pending.values())
			if (target.kind === SharedElementKind.Node) ids.add(target.id);
		return ids;
	}

	close(): void {
		this.buffer.close();
		this.pending.clear();
		this.edits.clear();
	}
}

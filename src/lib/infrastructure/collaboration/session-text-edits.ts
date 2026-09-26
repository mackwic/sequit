import type * as Y from 'yjs';

import { SharedElementKind, type SharedTarget } from '../document/shared-document-command';
import { YjsCollection } from './yjs-document-schema';

interface EditedTarget {
	readonly target: SharedTarget;
	readonly version: number;
}

/** Tracks pending user gestures, never replays text or rewrites Yjs history. */
export class SessionTextEdits {
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

	deletedNodes(document: Y.Doc, notify: (nodeId: string) => void): void {
		const nodes = document.getMap(YjsCollection.Nodes);
		let notified: Set<string> | undefined;
		for (const [key, value] of this.#active) {
			if (value.target.kind !== SharedElementKind.Node || nodes.has(value.target.id)) continue;
			this.#active.delete(key);
			if (notified?.has(value.target.id) === true) continue;
			notified ??= new Set<string>();
			notified.add(value.target.id);
			notify(value.target.id);
		}
	}

	clear(): void {
		this.#active.clear();
		this.#sent.clear();
	}
}

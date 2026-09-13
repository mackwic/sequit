import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { TextUpdateBuffer } from '../../../../src/lib/infrastructure/collaboration/text-update-buffer';

describe('local typing batch', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function setup() {
		const sent: Uint8Array[] = [];
		const buffer = new TextUpdateBuffer((update) => sent.push(update));
		const document = new Y.Doc();
		document.on('update', (update: Uint8Array) => {
			buffer.push(update);
		});
		return { buffer, document, sent, text: document.getText('text') };
	}

	it('shows local typing immediately but waits for 50ms of inactivity before sending one batch', () => {
		const { buffer, document, sent, text } = setup();
		text.insert(0, 'Alpha');
		expect(text.toJSON()).toBe('Alpha');
		vi.advanceTimersByTime(40);
		text.insert(5, ' modifié');
		vi.advanceTimersByTime(49);
		expect(sent).toHaveLength(0);
		vi.advanceTimersByTime(1);
		expect(sent).toHaveLength(1);
		const remote = new Y.Doc();
		for (const update of sent) Y.applyUpdate(remote, update);
		expect(remote.getText('text').toJSON()).toBe('Alpha modifié');
		vi.advanceTimersByTime(1000);
		expect(sent).toHaveLength(1);
		buffer.close();
		document.destroy();
		remote.destroy();
	});

	it('sends at 500ms during continuous typing and starts a new deadline for the next batch', () => {
		const { buffer, document, sent, text } = setup();
		text.insert(0, 'A');
		for (let index = 0; index < 12; index++) {
			vi.advanceTimersByTime(40);
			text.insert(text.length, 'a');
		}
		expect(sent).toHaveLength(0);
		vi.advanceTimersByTime(20);
		expect(sent).toHaveLength(1);
		text.insert(text.length, 'B');
		vi.advanceTimersByTime(49);
		expect(sent).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(sent).toHaveLength(2);
		buffer.close();
		document.destroy();
	});

	it('cancels pending typing and timers on terminal rejection', () => {
		const { buffer, document, sent, text } = setup();
		text.insert(0, 'abandoned');
		buffer.close();
		text.insert(0, 'ignored');
		buffer.flush();
		vi.advanceTimersByTime(1000);
		expect(sent).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
		document.destroy();
	});
});

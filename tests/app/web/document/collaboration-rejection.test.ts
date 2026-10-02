import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	consumeCollaborationError,
	refreshRejectedSession,
} from '../../../../src/app/web/document/collaboration-rejection';
import {
	SessionFailureCode,
	SessionNoticeCode,
} from '../../../../src/lib/infrastructure/collaboration/session-reasons';

function memoryStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		clear: () => {
			entries.clear();
		},
		getItem: (key) => entries.get(key) ?? null,
		key: (index) => [...entries.keys()][index] ?? null,
		removeItem: (key) => {
			entries.delete(key);
		},
		setItem: (key, value) => {
			entries.set(key, value);
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('terminal rejection refresh', () => {
	it('reloads the page and hands the message to the next load exactly once', () => {
		const reload = vi.fn();
		vi.stubGlobal('sessionStorage', memoryStorage());
		vi.stubGlobal('window', { location: { reload } });
		refreshRejectedSession({ code: SessionFailureCode.InvalidDocument, details: ['A & B'] });
		expect(reload).toHaveBeenCalledOnce();
		expect(consumeCollaborationError()).toBe('Document invalide. A & B');
		expect(consumeCollaborationError()).toBeUndefined();
	});
	it('still reloads when storage refuses the message', () => {
		const reload = vi.fn();
		vi.stubGlobal('sessionStorage', {
			setItem: () => {
				throw new Error('quota');
			},
			getItem: () => {
				throw new Error('quota');
			},
		});
		vi.stubGlobal('window', { location: { reload } });
		refreshRejectedSession({ code: SessionNoticeCode.InvalidMessage });
		expect(reload).toHaveBeenCalledOnce();
		expect(consumeCollaborationError()).toBeUndefined();
	});
});

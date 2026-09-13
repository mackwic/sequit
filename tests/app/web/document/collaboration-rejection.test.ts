import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ replaceState: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
import { replaceState } from '$app/navigation';

import {
	consumeCollaborationError,
	refreshRejectedSession,
} from '../../../../src/app/web/document/collaboration-rejection';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('terminal rejection navigation', () => {
	it('encodes the toast message in the refresh URL while preserving the room', () => {
		const replace = vi.fn();
		vi.stubGlobal('window', {
			location: {
				href: 'https://sequit.local/atelier/collaboration?room=test&name=Alice',
				replace,
			},
		});
		refreshRejectedSession('Refus : A & B');
		const url = new URL(String(replace.mock.calls[0]?.[0]));
		expect(url.searchParams.get('room')).toBe('test');
		expect(url.searchParams.get('collaboration-error')).toBe('Refus : A & B');
	});
	it('consumes the error once and removes it without another navigation', () => {
		vi.stubGlobal('window', {
			location: {
				href: 'https://sequit.local/atelier/collaboration?room=test&collaboration-error=Refus#canvas',
			},
		});
		expect(consumeCollaborationError('/atelier/collaboration')).toBe('Refus');
		expect(replaceState).toHaveBeenCalledWith('/atelier/collaboration?room=test#canvas', {});
	});
	it('does not alter a URL without an error', () => {
		vi.stubGlobal('window', { location: { href: 'https://sequit.local/atelier?room=test' } });
		expect(consumeCollaborationError('/atelier')).toBeUndefined();
		expect(replaceState).not.toHaveBeenCalled();
	});
});

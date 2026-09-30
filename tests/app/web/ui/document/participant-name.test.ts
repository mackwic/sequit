import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	normalizeParticipantName,
	PARTICIPANT_NAME_LIMIT,
	readParticipantName,
	writeParticipantName,
} from '../../../../../src/app/web/ui/document/participant-name';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('participant name', () => {
	it('collapses whitespace and bounds the length', () => {
		expect(normalizeParticipantName('  Alice \n  Dupont  ')).toBe('Alice Dupont');
		expect(normalizeParticipantName('x'.repeat(PARTICIPANT_NAME_LIMIT + 5))).toHaveLength(
			PARTICIPANT_NAME_LIMIT,
		);
	});

	it('round-trips through storage, normalized', () => {
		let stored: string | null = null;
		vi.stubGlobal('localStorage', {
			getItem: () => stored,
			setItem: (_key: string, value: string) => {
				stored = value;
			},
		});
		writeParticipantName('  Bob ');
		expect(stored).toBe('Bob');
		expect(readParticipantName()).toBe('Bob');
	});

	it('degrades to an empty name without storage', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
		});
		expect(() => {
			writeParticipantName('Alice');
		}).not.toThrow();
		expect(readParticipantName()).toBe('');
	});
});

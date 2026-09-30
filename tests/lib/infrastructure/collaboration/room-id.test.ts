import { describe, expect, it } from 'vitest';

import { isRoomId, newRoomId } from '../../../../src/lib/infrastructure/collaboration/room-id';

describe('room identifiers', () => {
	it('generates identifiers the route accepts and that do not collide', () => {
		const ids = new Set(Array.from({ length: 200 }, newRoomId));
		expect(ids.size).toBe(200);
		for (const id of ids) expect(isRoomId(id)).toBe(true);
	});

	it('rejects identifiers unfit for a URL segment or a document id', () => {
		expect(isRoomId('')).toBe(false);
		expect(isRoomId('abc')).toBe(false);
		expect(isRoomId('-abcd')).toBe(false);
		expect(isRoomId('Abcd')).toBe(false);
		expect(isRoomId('ab cd')).toBe(false);
		expect(isRoomId('a/b/c')).toBe(false);
		expect(isRoomId('a'.repeat(65))).toBe(false);
		expect(isRoomId('e2e-4f2a')).toBe(true);
	});
});

import { describe, expect, it } from 'vitest';

import {
	forgetDocument,
	parseRecentDocuments,
	RECENT_DOCUMENTS_KEY,
	RECENT_DOCUMENTS_LIMIT,
	type RecentDocument,
	type RecentDocuments,
	RecentDocumentsStore,
	rememberDocument,
	serializeRecentDocuments,
} from '../../../../../src/app/web/ui/document/recent-documents';

function document(id: string, updatedAt: number, title = id): RecentDocument {
	return { id, title, source: `id = "${id}"`, updatedAt };
}

function memoryStorage(initial?: string) {
	let stored = initial ?? null;
	return {
		getItem: () => stored,
		setItem: (_key: string, value: string) => {
			stored = value;
		},
		get stored() {
			return stored;
		},
	};
}

describe('parseRecentDocuments', () => {
	it('returns an empty store for missing, malformed or non-object storage', () => {
		const empty: RecentDocuments = { currentId: undefined, documents: [] };
		expect(parseRecentDocuments(null)).toEqual(empty);
		expect(parseRecentDocuments('{not json')).toEqual(empty);
		expect(parseRecentDocuments('42')).toEqual(empty);
		expect(parseRecentDocuments('{"documents":"nope"}')).toEqual(empty);
	});

	it('keeps valid entries, drops invalid ones and orders by recency', () => {
		const raw = JSON.stringify({
			currentId: 'b',
			documents: [
				document('a', 10),
				{ id: '', title: 'x', source: '', updatedAt: 5 },
				{ id: 'c', title: 'c', source: 'x', updatedAt: 'yesterday' },
				{ id: 'd', title: 'd', updatedAt: 3 },
				document('b', 20),
				'junk',
			],
		});
		expect(parseRecentDocuments(raw)).toEqual({
			currentId: 'b',
			documents: [document('b', 20), document('a', 10)],
		});
	});

	it('keeps the newest of duplicate identifiers', () => {
		const raw = JSON.stringify({ documents: [document('a', 10, 'old'), document('a', 30, 'new')] });
		expect(parseRecentDocuments(raw).documents).toEqual([document('a', 30, 'new')]);
	});

	it('clears a current identifier that no stored document carries', () => {
		const raw = JSON.stringify({ currentId: 'gone', documents: [document('a', 1)] });
		expect(parseRecentDocuments(raw).currentId).toBeUndefined();
	});

	it('round-trips through serialization', () => {
		const recent = rememberDocument(parseRecentDocuments(null), document('a', 1));
		expect(parseRecentDocuments(serializeRecentDocuments(recent))).toEqual(recent);
	});
});

describe('rememberDocument', () => {
	it('inserts at the front and makes the document current', () => {
		const recent = rememberDocument(
			{ currentId: 'a', documents: [document('a', 10)] },
			document('b', 20),
		);
		expect(recent).toEqual({ currentId: 'b', documents: [document('b', 20), document('a', 10)] });
	});

	it('refreshes an existing document in place of its older copy', () => {
		const recent = rememberDocument(
			{ currentId: 'b', documents: [document('b', 20), document('a', 10)] },
			document('a', 30, 'renamed'),
		);
		expect(recent).toEqual({
			currentId: 'a',
			documents: [document('a', 30, 'renamed'), document('b', 20)],
		});
	});

	it('evicts the oldest documents beyond the limit', () => {
		let recent = parseRecentDocuments(null);
		for (let index = 0; index <= RECENT_DOCUMENTS_LIMIT; index += 1) {
			recent = rememberDocument(recent, document(`d${String(index)}`, index));
		}
		expect(recent.documents).toHaveLength(RECENT_DOCUMENTS_LIMIT);
		expect(recent.documents.at(-1)?.id).toBe('d1');
		expect(recent.currentId).toBe(`d${String(RECENT_DOCUMENTS_LIMIT)}`);
	});
});

describe('forgetDocument', () => {
	it('removes the document and drops it as current', () => {
		const recent = forgetDocument(
			{ currentId: 'a', documents: [document('a', 10), document('b', 5)] },
			'a',
		);
		expect(recent).toEqual({ currentId: undefined, documents: [document('b', 5)] });
	});

	it('keeps another current document', () => {
		const recent = forgetDocument(
			{ currentId: 'b', documents: [document('a', 10), document('b', 5)] },
			'a',
		);
		expect(recent.currentId).toBe('b');
	});
});

describe('RecentDocumentsStore', () => {
	it('re-reads storage before each write so concurrent entries survive', () => {
		const storage = memoryStorage();
		const store = new RecentDocumentsStore(storage);
		store.remember(document('a', 10));
		// Another tab wrote in between.
		storage.setItem(
			RECENT_DOCUMENTS_KEY,
			serializeRecentDocuments({ currentId: 'z', documents: [document('z', 15)] }),
		);
		const recent = store.remember(document('a', 20));
		expect(recent).toEqual({ currentId: 'a', documents: [document('a', 20), document('z', 15)] });
		expect(parseRecentDocuments(storage.stored)).toEqual(recent);
	});

	it('forgets through storage', () => {
		const store = new RecentDocumentsStore(
			memoryStorage(
				serializeRecentDocuments({
					currentId: 'a',
					documents: [document('a', 10), document('b', 5)],
				}),
			),
		);
		expect(store.forget('a')).toEqual({ currentId: undefined, documents: [document('b', 5)] });
		expect(store.read().documents.map((entry) => entry.id)).toEqual(['b']);
	});

	it('propagates storage failures to the caller', () => {
		const store = new RecentDocumentsStore({
			getItem: () => null,
			setItem: () => {
				throw new Error('quota');
			},
		});
		expect(() => store.remember(document('a', 1))).toThrow('quota');
	});
});

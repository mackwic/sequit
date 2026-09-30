export interface RecentDocument {
	readonly id: string;
	readonly title: string;
	/** The serialized `.sequit.toml` source. */
	readonly source: string;
	/** Milliseconds since the epoch. */
	readonly updatedAt: number;
}

export interface RecentDocuments {
	/** The document to restore when the page loads. */
	readonly currentId: string | undefined;
	/** Most recently updated first. */
	readonly documents: readonly RecentDocument[];
}

export const RECENT_DOCUMENTS_KEY = 'sequit:recent-documents';
export const RECENT_DOCUMENTS_LIMIT = 12;

const EMPTY: RecentDocuments = { currentId: undefined, documents: [] };

function isNonEmptyString(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	return value !== '';
}

function isTimestamp(value: unknown): value is number {
	if (typeof value !== 'number') return false;
	return Number.isFinite(value);
}

function field(candidate: object, key: string): unknown {
	return Reflect.get(candidate, key);
}

function isRecentDocument(candidate: unknown): candidate is RecentDocument {
	if (!(candidate instanceof Object)) return false;
	if (!isNonEmptyString(field(candidate, 'id'))) return false;
	if (typeof field(candidate, 'title') !== 'string') return false;
	if (typeof field(candidate, 'source') !== 'string') return false;
	return isTimestamp(field(candidate, 'updatedAt'));
}

function newestPerId(documents: readonly RecentDocument[]): RecentDocument[] {
	const byId = new Map<string, RecentDocument>();
	for (const document of documents) {
		const known = byId.get(document.id);
		if (known === undefined || known.updatedAt < document.updatedAt)
			byId.set(document.id, document);
	}
	return [...byId.values()];
}

function normalize(currentId: unknown, documents: readonly RecentDocument[]): RecentDocuments {
	const ordered = newestPerId(documents)
		.sort((left, right) => right.updatedAt - left.updatedAt)
		.slice(0, RECENT_DOCUMENTS_LIMIT);
	const current = ordered.find((document) => document.id === currentId);
	return { currentId: current?.id, documents: ordered };
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/** Storage is untrusted: invalid entries are dropped, valid ones are kept. */
export function parseRecentDocuments(raw: string | null): RecentDocuments {
	if (raw === null) return EMPTY;
	const parsed = parseJson(raw);
	if (!(parsed instanceof Object)) return EMPTY;
	const documents = field(parsed, 'documents');
	if (!Array.isArray(documents)) return EMPTY;
	return normalize(field(parsed, 'currentId'), documents.filter(isRecentDocument));
}

export function serializeRecentDocuments(recent: RecentDocuments): string {
	return JSON.stringify(recent);
}

/** Inserts or refreshes `document` and makes it current. */
export function rememberDocument(
	recent: RecentDocuments,
	document: RecentDocument,
): RecentDocuments {
	const others = recent.documents.filter((known) => known.id !== document.id);
	return normalize(document.id, [document, ...others]);
}

export function forgetDocument(recent: RecentDocuments, id: string): RecentDocuments {
	const others = recent.documents.filter((document) => document.id !== id);
	return normalize(recent.currentId, others);
}

export interface RecentDocumentsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/**
 * Persists recent documents in a `Storage`. Every operation re-reads the storage so that another
 * tab's writes are not overwritten wholesale; the last writer wins for the same document.
 */
export class RecentDocumentsStore {
	readonly #storage: RecentDocumentsStorage;

	constructor(storage: RecentDocumentsStorage) {
		this.#storage = storage;
	}

	read(): RecentDocuments {
		return parseRecentDocuments(this.#storage.getItem(RECENT_DOCUMENTS_KEY));
	}

	remember(document: RecentDocument): RecentDocuments {
		return this.#write(rememberDocument(this.read(), document));
	}

	forget(id: string): RecentDocuments {
		return this.#write(forgetDocument(this.read(), id));
	}

	#write(recent: RecentDocuments): RecentDocuments {
		this.#storage.setItem(RECENT_DOCUMENTS_KEY, serializeRecentDocuments(recent));
		return recent;
	}
}

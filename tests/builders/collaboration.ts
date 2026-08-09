import * as Y from 'yjs';

export function proposeChange(
	authoritative: Y.Doc,
	mutate: (candidate: Y.Doc) => void,
): Uint8Array {
	const candidate = new Y.Doc();
	try {
		Y.applyUpdate(candidate, Y.encodeStateAsUpdate(authoritative));
		const before = Y.encodeStateVector(authoritative);
		mutate(candidate);
		return Y.encodeStateAsUpdate(candidate, before);
	} finally {
		candidate.destroy();
	}
}

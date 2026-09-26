import * as Y from 'yjs';

import type { SessionTextFlow } from './session-text-edits';
import { type SourceDocumentState, SourceDocumentStateKind } from './source-document-state';

interface ReplicaRecovery {
	readonly document: Y.Doc;
	readonly sourceState: SourceDocumentState;
	readonly notice: string;
}

/** A refused stale text batch cannot be undone inside an already-merged CRDT. */
export function replaceReplicaAfterTextRefusal(
	old: Y.Doc,
	state: SourceDocumentState,
	text: SessionTextFlow,
	onUpdate: (update: Uint8Array, origin: unknown) => void,
): ReplicaRecovery {
	const affected = [...text.discardedNodeIds()];
	text.close();
	old.off('update', onUpdate);
	const document = new Y.Doc();
	document.on('update', onUpdate);
	old.destroy();
	let location = 'du titre du document';
	if (affected.length > 0) location = `dans les boîtes ${affected.join(', ')}`;
	return {
		document,
		sourceState: { kind: SourceDocumentStateKind.Uninitialized, revision: state.revision + 1 },
		notice: `Les saisies non acquittées ${location} ont été abandonnées : une boîte a été supprimée ou remplacée. Synchronisation en cours.`,
	};
}

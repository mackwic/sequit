import * as Y from 'yjs';

import { YjsCollection } from './yjs-document-schema';

/** Upgrade scalar labels from existing room snapshots once, before publishing them. */
export function upgradeSharedTexts(document: Y.Doc): boolean {
	let changed = false;
	const upgrade = (map: Y.Map<unknown>, key: string): void => {
		const value = map.get(key);
		if (typeof value !== 'string') return;
		map.set(key, new Y.Text(value));
		changed = true;
	};
	document.transact(() => {
		upgrade(document.getMap(YjsCollection.Meta), 'title');
		for (const collection of [YjsCollection.Groups, YjsCollection.Natures]) {
			for (const map of document.getMap<Y.Map<unknown>>(collection).values()) upgrade(map, 'label');
		}
	});
	return changed;
}

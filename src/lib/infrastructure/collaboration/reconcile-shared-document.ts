import type * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import { syncSharedFields } from './shared-text';
import { createYjsEntityMap, YjsCollection } from './yjs-document-schema';

function syncCollection(
	document: Y.Doc,
	name: YjsCollection,
	entities: readonly { readonly id: string }[],
): void {
	const target = document.getMap<Y.Map<unknown>>(name);
	const ids = new Set(entities.map(({ id }) => id));
	for (const id of target.keys()) if (!ids.has(id)) target.delete(id);
	for (const entity of entities) {
		const values = Object.fromEntries(
			Object.entries(entity).filter(([key]) => key !== 'id' && key !== 'kind'),
		);
		let map = target.get(entity.id);
		if (map === undefined) {
			map = createYjsEntityMap({});
			target.set(entity.id, map);
		}
		syncSharedFields(map, values);
	}
}

/** Reconcile existing entities and texts in place; never reconstruct a live document. */
export function reconcileSharedDocument(
	document: Y.Doc,
	next: LogicDocument,
	origin: unknown,
): void {
	document.transact(() => {
		const meta = document.getMap(YjsCollection.Meta);
		syncSharedFields(meta, {
			...meta.toJSON(),
			id: next.id,
			title: next.title,
			layoutDirection: next.layout.direction,
			layoutBias: next.layout.bias,
		});
		syncCollection(document, YjsCollection.Natures, next.natures);
		syncCollection(document, YjsCollection.Groups, next.groups);
		syncCollection(document, YjsCollection.Nodes, next.nodes);
		syncCollection(document, YjsCollection.Junctions, next.junctions);
		syncCollection(document, YjsCollection.Relations, next.relations);
	}, origin);
}

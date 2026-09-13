import type * as Y from 'yjs';

import { defined } from '../../core/document/logic-document';
import { SharedElementKind, type SharedTarget } from '../document/shared-document-command';
import { isSharedTextField, sharedFieldValue } from './shared-text';
import { wireKeys } from './wire-values';
import { YjsCollection } from './yjs-document-schema';

const COLLECTIONS: Readonly<Record<SharedElementKind, YjsCollection>> = {
	[SharedElementKind.Document]: YjsCollection.Meta,
	[SharedElementKind.Node]: YjsCollection.Nodes,
	[SharedElementKind.Group]: YjsCollection.Groups,
	[SharedElementKind.Nature]: YjsCollection.Natures,
	[SharedElementKind.Junction]: YjsCollection.Junctions,
	[SharedElementKind.Relation]: YjsCollection.Relations,
};

const FIELDS: Readonly<Record<SharedElementKind, readonly string[]>> = {
	[SharedElementKind.Document]: ['title'],
	[SharedElementKind.Node]: ['markdown', 'natureId', 'groupId', 'color', 'icon'],
	[SharedElementKind.Group]: ['label', 'groupId', 'state'],
	[SharedElementKind.Nature]: ['label', 'color', 'icon'],
	[SharedElementKind.Junction]: ['operator', 'groupId'],
	[SharedElementKind.Relation]: ['from', 'to'],
};

export function elementCollection(document: Y.Doc, kind: SharedElementKind): Y.Map<Y.Map<unknown>> {
	return document.getMap(COLLECTIONS[kind]);
}

export function sharedElement(document: Y.Doc, target: SharedTarget): Y.Map<unknown> {
	if (target.kind === SharedElementKind.Document) {
		const meta = document.getMap(YjsCollection.Meta);
		if (meta.get('id') !== target.id) throw new Error('Document introuvable.');
		return meta;
	}
	return defined(elementCollection(document, target.kind).get(target.id), 'Élément introuvable.');
}

function assertProperties(
	kind: SharedElementKind,
	properties: Readonly<Record<string, string>>,
): void {
	wireKeys(properties, FIELDS[kind]);
}

export function updateSharedElement(
	document: Y.Doc,
	change: {
		readonly target: SharedTarget;
		readonly set: Readonly<Record<string, string>>;
		readonly unset: readonly string[];
	},
): void {
	assertProperties(change.target.kind, change.set);
	assertProperties(change.target.kind, Object.fromEntries(change.unset.map((key) => [key, ''])));
	const fields = [...Object.keys(change.set), ...change.unset];
	if (fields.some(isSharedTextField)) throw new Error('Use a Yjs update to edit text');
	const entity = sharedElement(document, change.target);
	for (const key of change.unset) entity.delete(key);
	for (const [key, value] of Object.entries(change.set)) entity.set(key, value);
}

export function initialElementProperties(
	kind: SharedElementKind,
	properties: Readonly<Record<string, string>>,
): Record<string, unknown> {
	assertProperties(kind, properties);
	return Object.fromEntries(
		Object.entries(properties).map(([key, value]) => [key, sharedFieldValue(key, value)]),
	);
}

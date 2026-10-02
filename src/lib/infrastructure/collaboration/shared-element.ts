import * as Y from 'yjs';

import { SharedElementKind, type SharedTarget } from '../document/shared-document-command';
import { StaleSharedCommandError } from './session-failure';
import { CommandRefusalCode } from './session-reasons';
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
	[SharedElementKind.Node]: [
		'markdown',
		'description',
		'natureId',
		'groupId',
		'laneId',
		'regionId',
		'color',
		'icon',
	],
	[SharedElementKind.Group]: ['label', 'color', 'groupId', 'laneId', 'regionId', 'state'],
	[SharedElementKind.Nature]: ['label', 'color', 'icon', 'family'],
	[SharedElementKind.Junction]: ['operator', 'groupId', 'laneId', 'regionId'],
	[SharedElementKind.Relation]: ['from', 'to'],
};

export function elementCollection(document: Y.Doc, kind: SharedElementKind): Y.Map<Y.Map<unknown>> {
	return document.getMap(COLLECTIONS[kind]);
}

export function sharedElement(document: Y.Doc, target: SharedTarget): Y.Map<unknown> {
	if (target.kind === SharedElementKind.Document) {
		const meta = document.getMap(YjsCollection.Meta);
		if (meta.get('id') !== target.id)
			throw new StaleSharedCommandError({ code: CommandRefusalCode.DocumentMissing });
		return meta;
	}
	const entity = elementCollection(document, target.kind).get(target.id);
	if (entity === undefined)
		throw new StaleSharedCommandError({ code: CommandRefusalCode.ElementMissing, target });
	return entity;
}

export function assertSharedProperties(
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
	assertSharedProperties(change.target.kind, change.set);
	assertSharedProperties(
		change.target.kind,
		Object.fromEntries(change.unset.map((key) => [key, ''])),
	);
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
	assertSharedProperties(kind, properties);
	return Object.fromEntries(
		Object.entries(properties).map(([key, value]) => [key, sharedFieldValue(key, value)]),
	);
}

export function isEditableSharedTextField(kind: SharedElementKind, field: string): boolean {
	return isSharedTextField(field) && FIELDS[kind].includes(field);
}

export function sharedTextAt(
	document: Y.Doc,
	target: SharedTarget,
	field: string,
): Y.Text | undefined {
	try {
		const value = sharedElement(document, target).get(field);
		if (value instanceof Y.Text) return value;
	} catch {
		// A peer can remove the entity between editing and reading it.
	}
	return undefined;
}

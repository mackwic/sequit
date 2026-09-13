import type * as Y from 'yjs';

import { GroupState, type LogicDocument } from '../../core/document/logic-document';
import { dissolveDocumentGroup } from '../document/document-group-operations';
import { finalizeSharedCommand, sharedElementOrder } from '../document/shared-command-rules';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
} from '../document/shared-document-command';
import { reconcileSharedDocument } from './reconcile-shared-document';
import {
	elementCollection,
	initialElementProperties,
	sharedElement,
	updateSharedElement,
} from './shared-element';
import { readLogicDocument } from './yjs-document-codec';
import { createYjsEntityMap, YjsCollection } from './yjs-document-schema';

function createElement(
	document: Y.Doc,
	command: Extract<SharedDocumentCommand, { op: SharedCommandKind.Create }>,
): void {
	const { target } = command;
	const properties = initialElementProperties(target.kind, command.properties);
	if (target.kind === SharedElementKind.Document)
		throw new Error('Utilisez initialize pour créer le document.');
	const collection = elementCollection(document, target.kind);
	if (collection.has(target.id)) throw new Error('Cet identifiant existe déjà.');
	if (
		[SharedElementKind.Node, SharedElementKind.Group, SharedElementKind.Junction].includes(
			target.kind,
		)
	)
		properties['layoutOrder'] = sharedElementOrder(target.id);
	if (target.kind === SharedElementKind.Group) properties['state'] ??= GroupState.Expanded;
	collection.set(target.id, createYjsEntityMap(properties));
}

function groupElements(
	document: Y.Doc,
	command: Extract<SharedDocumentCommand, { op: SharedCommandKind.Group }>,
): void {
	const members = command.members.map((id) => {
		for (const kind of [
			SharedElementKind.Node,
			SharedElementKind.Group,
			SharedElementKind.Junction,
		]) {
			const member = elementCollection(document, kind).get(id);
			if (member !== undefined) return member;
		}
		throw new Error('Un élément à regrouper est introuvable.');
	});
	if (members.length === 0) throw new Error('Sélectionnez les éléments à regrouper.');
	const parent = members[0]?.get('groupId');
	if (members.some((member) => member.get('groupId') !== parent))
		throw new Error('Les éléments doivent appartenir au même groupe.');
	const properties: Record<string, string> = { label: command.label };
	if (typeof parent === 'string') properties['groupId'] = parent;
	createElement(document, {
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Group, id: command.id },
		properties,
	});
	for (const member of members) member.set('groupId', command.id);
}

function replaceNature(
	document: Y.Doc,
	command: Extract<SharedDocumentCommand, { op: SharedCommandKind.Delete }>,
): void {
	const { target } = command;
	const nodes = elementCollection(document, SharedElementKind.Node);
	const affected = [...nodes.values()].filter((node) => node.get('natureId') === target.id);
	if (affected.length > 0) {
		if (command.replacementId === undefined)
			throw new Error('Choisissez une nature de remplacement.');
		if (command.replacementId === target.id) throw new Error('Choisissez une autre nature.');
		sharedElement(document, { kind: SharedElementKind.Nature, id: command.replacementId });
		for (const node of affected) node.set('natureId', command.replacementId);
	}
}

function deleteElement(
	document: Y.Doc,
	command: Extract<SharedDocumentCommand, { op: SharedCommandKind.Delete }>,
): void {
	const { target } = command;
	sharedElement(document, target);
	if (target.kind === SharedElementKind.Document)
		throw new Error('Le document ne peut pas être supprimé.');
	if (target.kind === SharedElementKind.Group)
		throw new Error('Utilisez ungroup pour dissoudre un groupe.');
	if (target.kind === SharedElementKind.Nature) replaceNature(document, command);
	elementCollection(document, target.kind).delete(target.id);
	const endpoint =
		target.kind === SharedElementKind.Node || target.kind === SharedElementKind.Junction;
	if (!endpoint) return;
	const relations = elementCollection(document, SharedElementKind.Relation);
	for (const [id, relation] of relations) {
		if (relation.get('from') === target.id || relation.get('to') === target.id)
			relations.delete(id);
	}
}

function execute(document: Y.Doc, command: SharedDocumentCommand): void {
	switch (command.op) {
		case SharedCommandKind.Create: {
			createElement(document, command);
			return;
		}
		case SharedCommandKind.Update: {
			updateSharedElement(document, command);
			return;
		}
		case SharedCommandKind.Delete: {
			deleteElement(document, command);
			return;
		}
		case SharedCommandKind.Group: {
			groupElements(document, command);
			return;
		}
		case SharedCommandKind.Ungroup: {
			const current = readLogicDocument(document);
			if (!current.ok) throw new Error('Document invalide.');
			reconcileSharedDocument(document, dissolveDocumentGroup(current.value, command.id), command);
			return;
		}
		case SharedCommandKind.UpdateLayout:
			document.getMap(YjsCollection.Meta).set('layoutDirection', command.layout.direction);
			document.getMap(YjsCollection.Meta).set('layoutBias', command.layout.bias);
			return;
		default:
			throw new Error('Unknown command');
	}
}

/** The caller owns this candidate and discards the whole batch on failure. */
export function executeSharedCommands(
	document: Y.Doc,
	commands: readonly SharedDocumentCommand[],
): LogicDocument {
	document.transact(() => {
		for (const command of commands) {
			const before = readLogicDocument(document);
			execute(document, command);
			if (!before.ok) continue; // Composed commands may temporarily leave references unresolved.
			const after = readLogicDocument(document);
			if (!after.ok) continue; // A composed command may temporarily leave references unresolved.
			reconcileSharedDocument(
				document,
				finalizeSharedCommand(before.value, after.value, command),
				command,
			);
		}
	}, commands);
	const final = readLogicDocument(document);
	if (!final.ok) throw new Error(final.diagnostics.map(({ message }) => message).join('; '));
	return final.value;
}

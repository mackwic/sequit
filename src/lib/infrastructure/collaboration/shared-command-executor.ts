import type * as Y from 'yjs';

import {
	GRID_PERSISTENCE_FORMAT,
	GroupState,
	LANE_PERSISTENCE_FORMAT,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_PERSISTENCE_FORMAT,
	REGION_POLICY_PERSISTENCE_FORMAT,
} from '../../core/document/logic-document';
import { ROOT_LAYOUT_REGION_ID } from '../../core/document/region-presentation';
import { dissolveDocumentGroup } from '../document/document-group-operations';
import { finalizeSharedCommand, sharedElementOrder } from '../document/shared-command-rules';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
} from '../document/shared-document-command';
import { reconcileSharedDocument } from './reconcile-shared-document';
import { BusinessCommandRefusal, StaleSharedCommandError } from './session-failure';
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
	if (target.kind === SharedElementKind.Node)
		properties['description'] ??= initialElementProperties(target.kind, { description: '' })[
			'description'
		];
	const collection = elementCollection(document, target.kind);
	if (collection.has(target.id)) throw new BusinessCommandRefusal('Cet identifiant existe déjà.');
	if (
		[SharedElementKind.Node, SharedElementKind.Group, SharedElementKind.Junction].includes(
			target.kind,
		)
	)
		properties['layoutOrder'] = sharedElementOrder(target.id);
	if (target.kind === SharedElementKind.Group) properties['state'] ??= GroupState.Expanded;
	collection.set(target.id, createYjsEntityMap(properties));
}

function groupingMembers(document: Y.Doc, ids: readonly string[]): readonly Y.Map<unknown>[] {
	return ids.map((id) => {
		for (const kind of [
			SharedElementKind.Node,
			SharedElementKind.Group,
			SharedElementKind.Junction,
		]) {
			const member = elementCollection(document, kind).get(id);
			if (member !== undefined) return member;
		}
		throw new StaleSharedCommandError('Un élément à regrouper est introuvable.');
	});
}

function regionOwner(member: Y.Map<unknown>): string {
	const id = member.get('regionId');
	if (typeof id === 'string') return id;
	return ROOT_LAYOUT_REGION_ID;
}

interface GroupProperties {
	label: string;
	groupId?: string;
	laneId?: string;
	regionId?: string;
}

function rootGroupOwnership(
	document: Y.Doc,
	first: Y.Map<unknown>,
	members: readonly Y.Map<unknown>[],
	properties: GroupProperties,
): void {
	const meta = document.getMap(YjsCollection.Meta);
	const format = meta.get('persistenceFormat');
	const lanes = format === LANE_PERSISTENCE_FORMAT;
	const regionFormats: readonly number[] = [
		REGION_PERSISTENCE_FORMAT,
		GRID_PERSISTENCE_FORMAT,
		REGION_LANE_PERSISTENCE_FORMAT,
		REGION_COMPOSITION_PERSISTENCE_FORMAT,
		REGION_POLICY_PERSISTENCE_FORMAT,
	];
	const regionFormat = typeof format === 'number' && regionFormats.includes(format);
	const owner = regionOwner(first);
	if (regionFormat && members.some((member) => regionOwner(member) !== owner))
		throw new StaleSharedCommandError('Les éléments doivent appartenir à la même région.');
	const regionLanes =
		regionFormat &&
		(meta.has('layoutPresentationSchema') || document.getMap(YjsCollection.RegionLanes).has(owner));
	if (lanes || regionLanes) {
		const laneId = members[0]?.get('laneId');
		if (typeof laneId !== 'string' || members.some((member) => member.get('laneId') !== laneId))
			throw new StaleSharedCommandError('Les éléments doivent appartenir à la même voie.');
		properties.laneId = laneId;
	}
	if (!regionFormat) return;
	if (owner !== ROOT_LAYOUT_REGION_ID) properties.regionId = owner;
}

function groupProperties(
	document: Y.Doc,
	members: readonly Y.Map<unknown>[],
	label: string,
): GroupProperties {
	const first = members[0];
	if (first === undefined)
		throw new BusinessCommandRefusal('Sélectionnez les éléments à regrouper.');
	const parent = first.get('groupId');
	if (members.some((member) => member.get('groupId') !== parent))
		throw new StaleSharedCommandError('Les éléments doivent appartenir au même groupe.');
	const properties: GroupProperties = { label };
	if (typeof parent === 'string') {
		properties.groupId = parent;
		return properties;
	}
	rootGroupOwnership(document, first, members, properties);
	return properties;
}

function groupElements(
	document: Y.Doc,
	command: Extract<SharedDocumentCommand, { op: SharedCommandKind.Group }>,
): void {
	const members = groupingMembers(document, command.members);
	const properties = groupProperties(document, members, command.label);
	createElement(document, {
		op: SharedCommandKind.Create,
		target: { kind: SharedElementKind.Group, id: command.id },
		properties,
	});
	for (const member of members) {
		member.set('groupId', command.id);
		member.delete('laneId');
		member.delete('regionId');
	}
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
			throw new BusinessCommandRefusal('Choisissez une nature de remplacement.');
		if (command.replacementId === target.id)
			throw new BusinessCommandRefusal('Choisissez une autre nature.');
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
		case SharedCommandKind.DeleteRelations: {
			const relations = elementCollection(document, SharedElementKind.Relation);
			for (const id of command.ids)
				sharedElement(document, { kind: SharedElementKind.Relation, id });
			for (const id of command.ids) relations.delete(id);
			return;
		}
		case SharedCommandKind.Group: {
			groupElements(document, command);
			return;
		}
		case SharedCommandKind.Ungroup: {
			sharedElement(document, { kind: SharedElementKind.Group, id: command.id });
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
	if (!final.ok)
		throw new BusinessCommandRefusal(final.diagnostics.map(({ message }) => message).join('; '));
	return final.value;
}

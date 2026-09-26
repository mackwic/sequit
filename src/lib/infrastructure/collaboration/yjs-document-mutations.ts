import * as Y from 'yjs';

import { contentStyleFields, defined, EndpointKind } from '../../core/document/logic-document';
import type { DocumentChangeSet } from '../../core/document/topology-edits';
import {
	type DocumentChangeResult,
	type DocumentCommandDiagnostic,
	DocumentCommandDiagnosticCode,
} from '../document/document-command-contracts';
import { spliceSharedText } from './shared-text';
import { createYjsEntityMap, YjsCollection } from './yjs-document-schema';

const GROUPS = YjsCollection.Groups;
const JUNCTIONS = YjsCollection.Junctions;
const NODES = YjsCollection.Nodes;
const RELATIONS = YjsCollection.Relations;
const COLLECTION_BY_ENDPOINT_KIND: Readonly<Record<EndpointKind, YjsCollection>> = {
	[EndpointKind.Group]: GROUPS,
	[EndpointKind.Node]: NODES,
	[EndpointKind.Junction]: JUNCTIONS,
};

type GroupAdditions = NonNullable<DocumentChangeSet['groupAdditions']>;
type NodeAdditions = DocumentChangeSet['nodeAdditions'];
type GroupReplacements = NonNullable<DocumentChangeSet['groupReplacements']>;
type EndpointGroupChanges = NonNullable<DocumentChangeSet['endpointGroupChanges']>;

export interface MarkdownTarget {
	readonly nodeId: string;
	readonly node: Y.Map<unknown>;
	readonly text: Y.Text;
}

export class YjsDocumentRepositoryRejection extends Error {
	constructor(readonly diagnostics: readonly DocumentCommandDiagnostic[]) {
		super(diagnostics.map(({ message }) => message).join('; '));
		this.name = 'YjsDocumentRepositoryRejection';
	}
}

export interface MarkdownTargetSuccess {
	readonly target: MarkdownTarget;
}

export interface MarkdownTargetFailure {
	readonly failure: DocumentChangeResult;
}

export function markdownTarget(document: Y.Doc, nodeId: string): MarkdownTarget {
	const node = document.getMap<Y.Map<unknown>>(NODES).get(nodeId);
	if (node === undefined) {
		throw new YjsDocumentRepositoryRejection([
			{
				code: DocumentCommandDiagnosticCode.NodeNotFound,
				message: `Node no longer exists: ${nodeId}`,
				path: ['nodes', nodeId],
			},
		]);
	}
	let markdown: unknown;
	if (node instanceof Y.Map) markdown = node.get('markdown');
	if (!(markdown instanceof Y.Text)) {
		throw new YjsDocumentRepositoryRejection([
			{
				code: DocumentCommandDiagnosticCode.NodeMarkdownUnavailable,
				message: `Node Markdown is unavailable: ${nodeId}`,
				path: ['nodes', nodeId, 'markdown'],
			},
		]);
	}
	return { nodeId, node, text: markdown };
}

export function lookupMarkdownTarget(
	document: Y.Doc,
	nodeId: string,
): MarkdownTargetSuccess | MarkdownTargetFailure {
	try {
		return { target: markdownTarget(document, nodeId) };
	} catch (error) {
		if (error instanceof YjsDocumentRepositoryRejection)
			return { failure: { ok: false, diagnostics: error.diagnostics } };
		throw error;
	}
}

function validateGroupAdditions(groups: Y.Map<Y.Map<unknown>>, additions: GroupAdditions): void {
	for (const group of additions) {
		if (groups.has(group.id))
			throw new Error(`Group addition conflicts with existing id: ${group.id}`);
	}
}

export function validateYjsAdditionConflicts(document: Y.Doc, changes: DocumentChangeSet): void {
	const groups = document.getMap<Y.Map<unknown>>(GROUPS);
	const nodes = document.getMap<Y.Map<unknown>>(NODES);
	const relations = document.getMap<Y.Map<unknown>>(RELATIONS);
	for (const node of changes.nodeAdditions) {
		if (nodes.has(node.id)) throw new Error(`Node addition conflicts with existing id: ${node.id}`);
	}
	for (const relation of changes.relationAdditions) {
		if (relations.has(relation.id))
			throw new Error(`Relation addition conflicts with existing id: ${relation.id}`);
	}
	validateGroupAdditions(groups, changes.groupAdditions ?? []);
}

function applyGroupAdditions(groups: Y.Map<Y.Map<unknown>>, additions: GroupAdditions): void {
	for (const group of additions) {
		const values: Record<string, unknown> = {
			label: new Y.Text(group.label),
			...contentStyleFields(group.color, undefined),
			layoutOrder: group.layoutOrder,
		};
		if (group.state !== undefined) values['state'] = group.state;
		if (group.groupId !== undefined) values['groupId'] = group.groupId;
		if (group.laneId !== undefined) values['laneId'] = group.laneId;
		if (group.regionId !== undefined) values['regionId'] = group.regionId;
		groups.set(group.id, createYjsEntityMap(values));
	}
}

function applyNodeAdditions(nodes: Y.Map<Y.Map<unknown>>, additions: NodeAdditions): void {
	for (const node of additions) {
		const values: Record<string, unknown> = {
			natureId: node.natureId,
			...contentStyleFields(node.color, node.icon),
			layoutOrder: node.layoutOrder,
			markdown: new Y.Text(node.markdown),
			description: new Y.Text(node.description ?? ''),
		};
		if (node.groupId !== undefined) values['groupId'] = node.groupId;
		if (node.laneId !== undefined) values['laneId'] = node.laneId;
		if (node.regionId !== undefined) values['regionId'] = node.regionId;
		nodes.set(node.id, createYjsEntityMap(values));
	}
}

function applyGroupReplacements(
	groups: Y.Map<Y.Map<unknown>>,
	replacements: GroupReplacements,
): void {
	for (const group of replacements) {
		const entity = defined(groups.get(group.id), `Group no longer exists: ${group.id}`);
		const label = entity.get('label');
		if (!(label instanceof Y.Text)) throw new Error(`Group label is unavailable: ${group.id}`);
		spliceSharedText(label, group.label);
		if (group.color === undefined) entity.delete('color');
		else entity.set('color', group.color);
	}
}

function applyEndpointGroupChanges(document: Y.Doc, changes: EndpointGroupChanges): void {
	for (const change of changes) {
		const endpoint = defined(
			document
				.getMap<Y.Map<unknown>>(COLLECTION_BY_ENDPOINT_KIND[change.endpointKind])
				.get(change.endpointId),
		);
		endpoint.set('groupId', change.groupId);
	}
}

export function applyYjsDocumentChanges(document: Y.Doc, changes: DocumentChangeSet): void {
	const groups = document.getMap<Y.Map<unknown>>(GROUPS);
	const nodes = document.getMap<Y.Map<unknown>>(NODES);
	const relations = document.getMap<Y.Map<unknown>>(RELATIONS);
	validateYjsAdditionConflicts(document, changes);
	for (const group of changes.groupReplacements ?? [])
		defined(groups.get(group.id), `Group no longer exists: ${group.id}`);
	const orderChanges = changes.endpointOrderChanges.map((change) => {
		const endpoint = document
			.getMap<Y.Map<unknown>>(COLLECTION_BY_ENDPOINT_KIND[change.endpointKind])
			.get(change.endpointId);
		return { endpoint: defined(endpoint), order: change.layoutOrder };
	});
	const markdownReplacements = changes.nodeMarkdownReplacements.map((replacement) => ({
		...replacement,
		text: markdownTarget(document, replacement.nodeId).text,
	}));
	applyNodeAdditions(nodes, changes.nodeAdditions);
	applyGroupAdditions(groups, changes.groupAdditions ?? []);
	applyGroupReplacements(groups, changes.groupReplacements ?? []);
	for (const relation of changes.relationAdditions)
		relations.set(relation.id, createYjsEntityMap({ from: relation.from, to: relation.to }));
	for (const removal of changes.endpointRemovals ?? [])
		document.getMap(COLLECTION_BY_ENDPOINT_KIND[removal.endpointKind]).delete(removal.endpointId);
	for (const id of changes.relationRemovals ?? []) relations.delete(id);
	for (const { endpoint, order } of orderChanges) endpoint.set('layoutOrder', order);
	applyEndpointGroupChanges(document, changes.endpointGroupChanges ?? []);
	for (const { text, markdown } of markdownReplacements) spliceSharedText(text, markdown);
}

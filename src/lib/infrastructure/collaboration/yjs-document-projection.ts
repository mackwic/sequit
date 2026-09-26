import {
	defined,
	EndpointKind,
	type LogicDocument,
	type LogicEndpoint,
	type LogicGroup,
	type LogicNode,
} from '../../core/document/logic-document';
import type { DocumentChangeSet } from '../../core/document/topology-edits';
import { validateLogicDocument } from '../../core/document/validate-logic-document';
import type { DocumentChangeResult } from '../document/document-command-contracts';
import { validateLogicDocumentGraph } from './yjs-document-codec';

export function isMarkdownOnly(changes: DocumentChangeSet): boolean {
	if (changes.nodeMarkdownReplacements.length === 0) return false;
	const noAdditions = changes.nodeAdditions.length === 0 && changes.relationAdditions.length === 0;
	const noEndpointRemovals = (changes.endpointRemovals?.length ?? 0) === 0;
	const noRelationRemovals = (changes.relationRemovals?.length ?? 0) === 0;
	const noRemovals = noEndpointRemovals && noRelationRemovals;
	const noGroupAdditions = (changes.groupAdditions?.length ?? 0) === 0;
	const noGroupReplacements = (changes.groupReplacements?.length ?? 0) === 0;
	const noEndpointGroupChanges = (changes.endpointGroupChanges?.length ?? 0) === 0;
	const noGroupChanges = noGroupAdditions && noGroupReplacements && noEndpointGroupChanges;
	const noOrderChanges = changes.endpointOrderChanges.length === 0;
	return noAdditions && noRemovals && noGroupChanges && noOrderChanges;
}

function updateEndpointFields<T extends LogicEndpoint>(endpoint: T, changes: DocumentChangeSet): T {
	let updated = endpoint;
	for (const change of changes.endpointOrderChanges) {
		if (change.endpointKind === endpoint.kind && change.endpointId === endpoint.id)
			updated = { ...updated, layoutOrder: change.layoutOrder };
	}
	for (const change of changes.endpointGroupChanges ?? []) {
		if (change.endpointKind === endpoint.kind && change.endpointId === endpoint.id)
			updated = { ...updated, groupId: change.groupId };
	}
	return updated;
}

function updateGroup(group: LogicGroup, changes: DocumentChangeSet): LogicGroup {
	let updated = group;
	for (const replacement of changes.groupReplacements ?? []) {
		if (replacement.id !== group.id) continue;
		const next = { ...updated, label: replacement.label };
		if (replacement.color === undefined) delete next.color;
		else next.color = replacement.color;
		updated = next;
	}
	return updated;
}

function updateNode(node: LogicNode, changes: DocumentChangeSet): LogicNode {
	let updated = node;
	for (const replacement of changes.nodeMarkdownReplacements) {
		if (replacement.nodeId === node.id) updated = { ...updated, markdown: replacement.markdown };
	}
	return updated;
}

function endpoint(
	document: LogicDocument,
	kind: EndpointKind,
	id: string,
): LogicEndpoint | undefined {
	switch (kind) {
		case EndpointKind.Group:
			return document.groups.find((candidate) => candidate.id === id);
		case EndpointKind.Node:
			return document.nodes.find((candidate) => candidate.id === id);
		case EndpointKind.Junction:
			return document.junctions.find((candidate) => candidate.id === id);
		default:
			return undefined;
	}
}

function endpointRemovals(changes: DocumentChangeSet, kind: EndpointKind): ReadonlySet<string> {
	return new Set(
		(changes.endpointRemovals ?? [])
			.filter((removal) => removal.endpointKind === kind)
			.map((removal) => removal.endpointId),
	);
}

export function projectYjsDocumentChange(
	current: LogicDocument,
	changes: DocumentChangeSet,
): DocumentChangeResult {
	if (isMarkdownOnly(changes)) {
		const markdownById = new Map(
			changes.nodeMarkdownReplacements.map(({ nodeId, markdown }) => [nodeId, markdown]),
		);
		return {
			ok: true,
			value: {
				...current,
				nodes: current.nodes.map((node) => {
					const markdown = markdownById.get(node.id);
					if (markdown === undefined) return node;
					return { ...node, markdown };
				}),
			},
		};
	}
	for (const node of changes.nodeAdditions) {
		if (current.nodes.some(({ id }) => id === node.id))
			throw new Error(`Node addition conflicts with existing id: ${node.id}`);
	}
	for (const relation of changes.relationAdditions) {
		if (current.relations.some(({ id }) => id === relation.id))
			throw new Error(`Relation addition conflicts with existing id: ${relation.id}`);
	}
	for (const group of changes.groupAdditions ?? []) {
		if (current.groups.some(({ id }) => id === group.id))
			throw new Error(`Group addition conflicts with existing id: ${group.id}`);
	}
	for (const group of changes.groupReplacements ?? [])
		defined(
			current.groups.find(({ id }) => id === group.id),
			`Group no longer exists: ${group.id}`,
		);
	for (const change of changes.endpointOrderChanges)
		defined(
			endpoint(current, change.endpointKind, change.endpointId),
			`Endpoint no longer exists: ${change.endpointId}`,
		);

	const removedGroups = endpointRemovals(changes, EndpointKind.Group);
	const removedNodes = endpointRemovals(changes, EndpointKind.Node);
	const removedJunctions = endpointRemovals(changes, EndpointKind.Junction);
	const removedRelations = new Set(changes.relationRemovals ?? []);
	const projected: LogicDocument = {
		...current,
		groups: [...current.groups, ...(changes.groupAdditions ?? [])]
			.map((group) => updateGroup(updateEndpointFields(group, changes), changes))
			.filter(({ id }) => !removedGroups.has(id)),
		nodes: [...current.nodes, ...changes.nodeAdditions]
			.map((node) => updateNode(updateEndpointFields(node, changes), changes))
			.filter(({ id }) => !removedNodes.has(id)),
		junctions: current.junctions
			.map((junction) => updateEndpointFields(junction, changes))
			.filter(({ id }) => !removedJunctions.has(id)),
		relations: [...current.relations, ...changes.relationAdditions].filter(
			({ id }) => !removedRelations.has(id),
		),
	};
	for (const change of changes.endpointGroupChanges ?? [])
		defined(
			endpoint(projected, change.endpointKind, change.endpointId),
			`Endpoint no longer exists: ${change.endpointId}`,
		);

	const validated = validateLogicDocument(projected);
	if (!validated.ok) return { ok: false, diagnostics: validated.diagnostics };
	const graph = validateLogicDocumentGraph(validated.value);
	if (!graph.ok) return { ok: false, diagnostics: graph.diagnostics };
	return { ok: true, value: validated.value };
}

import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import {
	EndpointKind,
	type GroupState,
	type LogicDocument,
	type LogicGroup,
	type LogicJunction,
	type LogicNode,
} from '../../../lib/core/document/logic-document';
import {
	type ClipboardSelection,
	type CopiedGroup,
	type CopiedJunction,
	type CopiedNode,
	NODE_CLIPBOARD_PREFIX as PREFIX,
} from './node-clipboard-types';

const NODE_KIND: string = EndpointKind.Node;

function copiedNode(node: LogicNode): CopiedNode {
	const copy: {
		natureId: string;
		markdown: string;
		description?: string;
		color?: string;
		icon?: string;
		groupId?: string;
		laneId?: string;
		regionId?: string;
		id: string;
	} = { id: node.id, natureId: node.natureId, markdown: node.markdown };
	if (node.description !== undefined) copy.description = node.description;
	if (node.color !== undefined) copy.color = node.color;
	if (node.icon !== undefined) copy.icon = node.icon;
	if (node.groupId !== undefined) copy.groupId = node.groupId;
	if (node.laneId !== undefined) copy.laneId = node.laneId;
	if (node.regionId !== undefined) copy.regionId = node.regionId;
	return copy;
}

function copiedGroup(group: LogicGroup): CopiedGroup {
	const copy: {
		id: string;
		label: string;
		state?: GroupState;
		color?: string;
		groupId?: string;
		laneId?: string;
		regionId?: string;
	} = { id: group.id, label: group.label };
	if (group.state !== undefined) copy.state = group.state;
	if (group.color !== undefined) copy.color = group.color;
	if (group.groupId !== undefined) copy.groupId = group.groupId;
	if (group.laneId !== undefined) copy.laneId = group.laneId;
	if (group.regionId !== undefined) copy.regionId = group.regionId;
	return copy;
}

function copiedJunction(junction: LogicJunction): CopiedJunction {
	const copy: {
		id: string;
		operator: LogicJunction['operator'];
		groupId?: string;
		laneId?: string;
		regionId?: string;
	} = { id: junction.id, operator: junction.operator };
	if (junction.groupId !== undefined) copy.groupId = junction.groupId;
	if (junction.laneId !== undefined) copy.laneId = junction.laneId;
	if (junction.regionId !== undefined) copy.regionId = junction.regionId;
	return copy;
}

function orderedByLayout<T extends { readonly id: string; readonly layoutOrder: string }>(
	items: readonly T[],
): T[] {
	return [...items].sort((left, right) => {
		const byOrder = compareCanonicalStrings(left.layoutOrder, right.layoutOrder);
		if (byOrder !== 0) return byOrder;
		return compareCanonicalStrings(left.id, right.id);
	});
}

function copiedGroupIds(document: LogicDocument, nodes: readonly LogicNode[]): Set<string> {
	const groups = new Map(document.groups.map((group) => [group.id, group]));
	const ids = new Set<string>();
	for (const node of nodes) {
		let groupId = node.groupId;
		while (groupId !== undefined && !ids.has(groupId)) {
			ids.add(groupId);
			groupId = groups.get(groupId)?.groupId;
		}
	}
	return ids;
}

/** Junctions are copied only when they lie on a directed path between copied endpoints. */
function connectingJunctionIds(
	document: LogicDocument,
	selectedEndpoints: ReadonlySet<string>,
): Set<string> {
	const junctionIds = new Set(document.junctions.map(({ id }) => id));
	const forward = new Set(selectedEndpoints);
	const backward = new Set(selectedEndpoints);
	let changed = true;
	while (changed) {
		changed = false;
		for (const { from, to } of document.relations) {
			if (forward.has(from) && junctionIds.has(to) && !forward.has(to)) {
				forward.add(to);
				changed = true;
			}
			if (backward.has(to) && junctionIds.has(from) && !backward.has(from)) {
				backward.add(from);
				changed = true;
			}
		}
	}
	return new Set([...junctionIds].filter((id) => forward.has(id) && backward.has(id)));
}

/** Copy is available only for a nonempty selection made entirely of nodes. */
export function serializeSelectedNodes(
	document: LogicDocument,
	selection: Iterable<ClipboardSelection>,
): string | undefined {
	const selected = [...selection];
	if (selected.length === 0) return undefined;
	if (selected.some(({ kind }) => kind !== NODE_KIND)) return undefined;
	const ids = new Set(selected.map(({ id }) => id));
	const nodes = document.nodes.filter(({ id }) => ids.has(id));
	if (nodes.length !== ids.size) return undefined;
	const groupIds = copiedGroupIds(document, nodes);
	const groups = document.groups.filter(({ id }) => groupIds.has(id));
	const endpoints = new Set([...ids, ...groupIds]);
	const junctionIds = connectingJunctionIds(document, endpoints);
	for (const id of junctionIds) endpoints.add(id);
	const junctions = document.junctions.filter(({ id }) => junctionIds.has(id));
	const relations = document.relations.filter(
		({ from, to }) => endpoints.has(from) && endpoints.has(to),
	);
	return (
		PREFIX +
		JSON.stringify({
			documentId: document.id,
			nodes: orderedByLayout(nodes).map(copiedNode),
			groups: orderedByLayout(groups).map(copiedGroup),
			junctions: orderedByLayout(junctions).map(copiedJunction),
			relations: [...relations].sort((a, b) => compareCanonicalStrings(a.id, b.id)),
		})
	);
}

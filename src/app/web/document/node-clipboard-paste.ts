import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import {
	GroupState,
	type JunctionOperator,
	type LogicDocument,
} from '../../../lib/core/document/logic-document';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
} from '../../../lib/infrastructure/document/shared-document-command';
import type {
	CopiedGroup,
	CopiedJunction,
	CopiedNode,
	NodeClipboard,
	NodePasteDestination,
} from './node-clipboard-types';

interface MutableNodeProperties {
	natureId: string;
	markdown: string;
	description?: string;
	color?: string;
	icon?: string;
	groupId?: string;
	laneId?: string;
	regionId?: string;
}

interface MutableJunctionProperties {
	operator: JunctionOperator;
	groupId?: string;
	laneId?: string;
	regionId?: string;
}

function remappedPlacement(
	item: NodePasteDestination,
	destination: NodePasteDestination | undefined,
	groupIds: ReadonlyMap<string, string>,
): NodePasteDestination {
	let copiedGroupId: string | undefined;
	if (item.groupId !== undefined) copiedGroupId = groupIds.get(item.groupId);
	if (copiedGroupId !== undefined) return { groupId: copiedGroupId };
	return destination ?? item;
}

function nodeProperties(
	node: CopiedNode,
	placement: NodePasteDestination,
	firstLane: string | undefined,
): MutableNodeProperties {
	const properties: MutableNodeProperties = { natureId: node.natureId, markdown: node.markdown };
	if (node.description !== undefined) properties.description = node.description;
	if (node.color !== undefined) properties.color = node.color;
	if (node.icon !== undefined) properties.icon = node.icon;
	if (placement.groupId !== undefined) {
		properties.groupId = placement.groupId;
		return properties;
	}
	const laneId = placement.laneId ?? firstLane;
	if (laneId !== undefined) properties.laneId = laneId;
	if (placement.regionId !== undefined) properties.regionId = placement.regionId;
	return properties;
}

function junctionProperties(
	junction: CopiedJunction,
	placement: NodePasteDestination,
	firstLane: string | undefined,
): MutableJunctionProperties {
	const properties: MutableJunctionProperties = { operator: junction.operator };
	if (placement.groupId !== undefined) {
		properties.groupId = placement.groupId;
		return properties;
	}
	const laneId = placement.laneId ?? firstLane;
	if (laneId !== undefined) properties.laneId = laneId;
	if (placement.regionId !== undefined) properties.regionId = placement.regionId;
	return properties;
}

interface NodePastePlan {
	readonly ids: readonly string[];
	readonly commands: readonly SharedDocumentCommand[];
}

function groupDepth(group: CopiedGroup, groups: ReadonlyMap<string, CopiedGroup>): number {
	let depth = 0;
	let parentId = group.groupId;
	const visited = new Set([group.id]);
	while (parentId !== undefined) {
		if (!groups.has(parentId)) break;
		if (visited.has(parentId)) break;
		visited.add(parentId);
		depth += 1;
		parentId = groups.get(parentId)?.groupId;
	}
	return depth;
}

interface PasteContext {
	readonly destination: NodePasteDestination | undefined;
	readonly firstLane: string | undefined;
	readonly newId: () => string;
	readonly existingGroupIds: ReadonlySet<string>;
	readonly natureIds: ReadonlySet<string>;
	readonly remappedIds: Map<string, string>;
	readonly ids: string[];
	readonly commands: SharedDocumentCommand[];
}

function groupProperties(
	group: CopiedGroup,
	placement: NodePasteDestination,
	firstLane: string | undefined,
) {
	const properties: {
		label: string;
		state?: GroupState;
		color?: string;
		groupId?: string;
		laneId?: string;
		regionId?: string;
	} = { label: group.label };
	if (group.state !== undefined) properties.state = group.state;
	if (group.color !== undefined) properties.color = group.color;
	if (placement.groupId !== undefined) {
		properties.groupId = placement.groupId;
		return properties;
	}
	const laneId = placement.laneId ?? firstLane;
	if (laneId !== undefined) properties.laneId = laneId;
	if (placement.regionId !== undefined) properties.regionId = placement.regionId;
	return properties;
}

function appendGroups(context: PasteContext, copied: readonly CopiedGroup[]): void {
	const groups = new Map(copied.map((group) => [group.id, group]));
	const ordered = [...copied].sort((left, right) => {
		const depth = groupDepth(left, groups) - groupDepth(right, groups);
		if (depth !== 0) return depth;
		return compareCanonicalStrings(left.id, right.id);
	});
	for (const group of ordered) {
		const id = context.newId();
		context.remappedIds.set(group.id, id);
		const placement = remappedPlacement(group, context.destination, context.remappedIds);
		context.commands.push({
			op: SharedCommandKind.Create,
			target: { kind: SharedElementKind.Group, id },
			properties: groupProperties(group, placement, context.firstLane),
		});
	}
}

function existingOrCopiedGroup(context: PasteContext, groupId: string | undefined): boolean {
	if (groupId === undefined) return true;
	if (context.existingGroupIds.has(groupId)) return true;
	return [...context.remappedIds.values()].includes(groupId);
}

function appendNodes(context: PasteContext, copied: readonly CopiedNode[]): boolean {
	for (const node of copied) {
		if (!context.natureIds.has(node.natureId)) return false;
		const placement = remappedPlacement(node, context.destination, context.remappedIds);
		if (!existingOrCopiedGroup(context, placement.groupId)) return false;
		const id = context.newId();
		context.remappedIds.set(node.id, id);
		context.ids.push(id);
		context.commands.push({
			op: SharedCommandKind.Create,
			target: { kind: SharedElementKind.Node, id },
			properties: nodeProperties(node, placement, context.firstLane),
		});
	}
	return true;
}

function appendJunctions(context: PasteContext, copied: readonly CopiedJunction[]): boolean {
	for (const junction of copied) {
		const placement = remappedPlacement(junction, context.destination, context.remappedIds);
		if (!existingOrCopiedGroup(context, placement.groupId)) return false;
		const id = context.newId();
		context.remappedIds.set(junction.id, id);
		context.commands.push({
			op: SharedCommandKind.Create,
			target: { kind: SharedElementKind.Junction, id },
			properties: junctionProperties(junction, placement, context.firstLane),
		});
	}
	return true;
}

function appendRelations(context: PasteContext, copied: NodeClipboard['relations']): boolean {
	for (const relation of copied) {
		const from = context.remappedIds.get(relation.from);
		const to = context.remappedIds.get(relation.to);
		if (from === undefined || to === undefined) return false;
		context.commands.push({
			op: SharedCommandKind.Create,
			target: { kind: SharedElementKind.Relation, id: context.newId() },
			properties: { from, to },
		});
	}
	return true;
}

/** Fresh ids and one command batch for the copied subgraph. */
export function planNodePaste(
	document: LogicDocument,
	clipboard: NodeClipboard,
	destination: NodePasteDestination | undefined,
	newId: () => string,
): NodePastePlan | undefined {
	if (clipboard.documentId !== document.id) return undefined;
	const groups = new Map(document.groups.map((group) => [group.id, group]));
	if (destination?.groupId !== undefined && !groups.has(destination.groupId)) return undefined;
	const orderedLanes = document.presentation?.lanes.toSorted((left, right) =>
		compareCanonicalStrings(left.layoutOrder, right.layoutOrder),
	);
	const context: PasteContext = {
		destination,
		firstLane: orderedLanes?.[0]?.id,
		newId,
		existingGroupIds: new Set(groups.keys()),
		natureIds: new Set(document.natures.map(({ id }) => id)),
		remappedIds: new Map(),
		ids: [],
		commands: [],
	};
	let targetGroup;
	if (destination?.groupId !== undefined) targetGroup = groups.get(destination.groupId);
	if (targetGroup?.state === GroupState.Closed)
		context.commands.push({
			op: SharedCommandKind.Update,
			target: { kind: SharedElementKind.Group, id: targetGroup.id },
			set: { state: GroupState.Expanded },
			unset: [],
		});
	appendGroups(context, clipboard.groups);
	if (!appendNodes(context, clipboard.nodes)) return undefined;
	if (!appendJunctions(context, clipboard.junctions)) return undefined;
	if (!appendRelations(context, clipboard.relations)) return undefined;
	return { ids: context.ids, commands: context.commands };
}

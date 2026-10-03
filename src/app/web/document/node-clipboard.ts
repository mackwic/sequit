import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import {
	EndpointKind,
	GroupState,
	type LogicDocument,
	type LogicNode,
} from '../../../lib/core/document/logic-document';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
} from '../../../lib/infrastructure/document/shared-document-command';

const PREFIX = 'sequit:nodes:1\n';
const NODE_KIND: string = EndpointKind.Node;
const GROUP_KIND: string = EndpointKind.Group;
const JUNCTION_KIND: string = EndpointKind.Junction;

interface ClipboardSelection {
	readonly kind: string;
	readonly id: string;
}

interface CopiedNode {
	readonly natureId: string;
	readonly markdown: string;
	readonly description?: string;
	readonly color?: string;
	readonly icon?: string;
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

export interface NodeClipboard {
	readonly documentId: string;
	readonly nodes: readonly CopiedNode[];
}

/** An explicit destination replaces every copied node's original container. */
export interface NodePasteDestination {
	readonly groupId?: string;
	readonly laneId?: string;
	readonly regionId?: string;
}

export function isNodeClipboardText(text: string): boolean {
	return text.startsWith(PREFIX);
}

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
	} = { natureId: node.natureId, markdown: node.markdown };
	if (node.description !== undefined) copy.description = node.description;
	if (node.color !== undefined) copy.color = node.color;
	if (node.icon !== undefined) copy.icon = node.icon;
	if (node.groupId !== undefined) copy.groupId = node.groupId;
	if (node.laneId !== undefined) copy.laneId = node.laneId;
	if (node.regionId !== undefined) copy.regionId = node.regionId;
	return copy;
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
	const ordered = [...nodes].sort((left, right) => {
		const byOrder = compareCanonicalStrings(left.layoutOrder, right.layoutOrder);
		if (byOrder !== 0) return byOrder;
		return compareCanonicalStrings(left.id, right.id);
	});
	return PREFIX + JSON.stringify({ documentId: document.id, nodes: ordered.map(copiedNode) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (value === null) return false;
	if (typeof value !== 'object') return false;
	return !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
	if (value === undefined) return true;
	return typeof value === 'string';
}

function readCopiedNode(value: unknown): CopiedNode | undefined {
	if (!isRecord(value)) return undefined;
	const natureId = value['natureId'];
	const markdown = value['markdown'];
	if (typeof natureId !== 'string') return undefined;
	if (typeof markdown !== 'string') return undefined;
	const fields = ['description', 'color', 'icon', 'groupId', 'laneId', 'regionId'];
	if (fields.some((field) => !optionalString(value[field]))) return undefined;
	const copy: {
		natureId: string;
		markdown: string;
		description?: string;
		color?: string;
		icon?: string;
		groupId?: string;
		laneId?: string;
		regionId?: string;
	} = { natureId, markdown };
	if (typeof value['description'] === 'string') copy.description = value['description'];
	if (typeof value['color'] === 'string') copy.color = value['color'];
	if (typeof value['icon'] === 'string') copy.icon = value['icon'];
	if (typeof value['groupId'] === 'string') copy.groupId = value['groupId'];
	if (typeof value['laneId'] === 'string') copy.laneId = value['laneId'];
	if (typeof value['regionId'] === 'string') copy.regionId = value['regionId'];
	return copy;
}

/** The clipboard is external input, even when it originated in this browser. */
export function parseNodeClipboard(text: string, documentId: string): NodeClipboard | undefined {
	if (!isNodeClipboardText(text)) return undefined;
	let payload: unknown;
	try {
		payload = JSON.parse(text.slice(PREFIX.length));
	} catch {
		return undefined;
	}
	if (!isRecord(payload)) return undefined;
	if (payload['documentId'] !== documentId) return undefined;
	const rawNodes = payload['nodes'];
	if (!isUnknownArray(rawNodes) || rawNodes.length === 0) return undefined;
	const nodes: CopiedNode[] = [];
	for (const raw of rawNodes) {
		const node = readCopiedNode(raw);
		if (node === undefined) return undefined;
		nodes.push(node);
	}
	return { documentId, nodes };
}

function endpointPlacement(
	document: LogicDocument,
	item: ClipboardSelection,
): NodePasteDestination | undefined {
	if (item.kind === NODE_KIND) return document.nodes.find(({ id }) => id === item.id);
	if (item.kind === JUNCTION_KIND) return document.junctions.find(({ id }) => id === item.id);
	return undefined;
}

function samePlacement(left: NodePasteDestination, right: NodePasteDestination): boolean {
	if (left.groupId !== right.groupId) return false;
	if (left.laneId !== right.laneId) return false;
	return left.regionId === right.regionId;
}

/** The focused selection supplies a destination only when all its members share one container. */
export function selectionPasteDestination(
	document: LogicDocument,
	selection: Iterable<ClipboardSelection>,
): NodePasteDestination | undefined {
	const selected = [...selection];
	if (selected.length === 0) return undefined;
	if (selected.length === 1 && selected[0]?.kind === GROUP_KIND) return { groupId: selected[0].id };
	const first = selected[0];
	if (first === undefined) return undefined;
	const placement = endpointPlacement(document, first);
	if (placement === undefined) return undefined;
	for (const item of selected.slice(1)) {
		const next = endpointPlacement(document, item);
		if (next === undefined || !samePlacement(placement, next)) return undefined;
	}
	const result: { groupId?: string; laneId?: string; regionId?: string } = {};
	if (placement.groupId !== undefined) result.groupId = placement.groupId;
	if (placement.laneId !== undefined) result.laneId = placement.laneId;
	if (placement.regionId !== undefined) result.regionId = placement.regionId;
	return result;
}

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

export interface NodePastePlan {
	readonly ids: readonly string[];
	readonly commands: readonly SharedDocumentCommand[];
}

/** Fresh ids and one command batch; no relation or junction is copied. */
export function planNodePaste(
	document: LogicDocument,
	clipboard: NodeClipboard,
	destination: NodePasteDestination | undefined,
	newId: () => string,
): NodePastePlan | undefined {
	if (clipboard.documentId !== document.id) return undefined;
	const groups = new Map(document.groups.map((group) => [group.id, group]));
	const natures = new Set(document.natures.map(({ id }) => id));
	if (destination?.groupId !== undefined && !groups.has(destination.groupId)) return undefined;
	const orderedLanes = document.presentation?.lanes.toSorted((left, right) =>
		compareCanonicalStrings(left.layoutOrder, right.layoutOrder),
	);
	const firstLane = orderedLanes?.[0]?.id;
	const ids: string[] = [];
	const commands: SharedDocumentCommand[] = [];
	let targetGroup;
	if (destination?.groupId !== undefined) targetGroup = groups.get(destination.groupId);
	if (targetGroup?.state === GroupState.Closed)
		commands.push({
			op: SharedCommandKind.Update,
			target: { kind: SharedElementKind.Group, id: targetGroup.id },
			set: { state: GroupState.Expanded },
			unset: [],
		});
	for (const node of clipboard.nodes) {
		if (!natures.has(node.natureId)) return undefined;
		const placement = destination ?? node;
		if (placement.groupId !== undefined && !groups.has(placement.groupId)) return undefined;
		const id = newId();
		ids.push(id);
		commands.push({
			op: SharedCommandKind.Create,
			target: { kind: SharedElementKind.Node, id },
			properties: nodeProperties(node, placement, firstLane),
		});
	}
	return { ids, commands };
}

import { EndpointKind, type LogicDocument } from '../../../lib/core/document/logic-document';
import type { ClipboardSelection, NodePasteDestination } from './node-clipboard-types';

const NODE_KIND: string = EndpointKind.Node;
const GROUP_KIND: string = EndpointKind.Group;
const JUNCTION_KIND: string = EndpointKind.Junction;

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

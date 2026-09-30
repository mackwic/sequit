import {
	defined,
	LaneOrientation,
	type LayoutLane,
	type LogicDocument,
} from '../../../lib/core/document/logic-document';
import { fractionalOrderKeySpace } from '../../../lib/core/ordering/order-key-space';
import type { SharedRootLanes } from '../../../lib/infrastructure/document/shared-document-command';
import { rootLanes } from '../ui/canvas/root-lanes';

export interface LaneDraftEntry {
	readonly id: string;
	readonly label: string;
}

/** What the lanes dialog edits; an empty lane list means a single implicit lane. */
export interface LanesDraft {
	readonly orientation: LaneOrientation;
	/** Reading order. */
	readonly lanes: readonly LaneDraftEntry[];
	/** Lanes of the document, with how many top-level elements each holds. */
	readonly existing: readonly (LaneDraftEntry & { readonly count: number })[];
	/** Where the content of a removed lane goes. */
	readonly transfers: Readonly<Record<string, string>>;
}

export function lanesDraft(document: LogicDocument): LanesDraft {
	const counts = new Map<string, number>();
	for (const item of [...document.nodes, ...document.groups, ...document.junctions]) {
		if (item.groupId !== undefined || item.laneId === undefined) continue;
		counts.set(item.laneId, (counts.get(item.laneId) ?? 0) + 1);
	}
	const lanes = rootLanes(document).map(({ id, label }) => ({ id, label }));
	return {
		orientation: document.presentation?.laneOrientation ?? LaneOrientation.Parallel,
		lanes,
		existing: lanes.map((lane) => ({ ...lane, count: counts.get(lane.id) ?? 0 })),
		transfers: {},
	};
}

function newLane(draft: LanesDraft, id: string): LaneDraftEntry {
	return { id, label: `Lane ${draft.lanes.length + 1}` };
}

/** Two lanes at least; the author renames them next. */
export function activateLanes(draft: LanesDraft, newId: () => string): LanesDraft {
	const first = newLane(draft, newId());
	const second = newLane({ ...draft, lanes: [first] }, newId());
	return { ...draft, lanes: [first, second] };
}

export function addLane(draft: LanesDraft, id: string): LanesDraft {
	return { ...draft, lanes: [...draft.lanes, newLane(draft, id)] };
}

export function renameLane(draft: LanesDraft, id: string, label: string): LanesDraft {
	return {
		...draft,
		lanes: draft.lanes.map((lane) => {
			if (lane.id !== id) return lane;
			return { ...lane, label };
		}),
	};
}

export function moveLane(draft: LanesDraft, id: string, offset: -1 | 1): LanesDraft {
	const index = draft.lanes.findIndex((lane) => lane.id === id);
	const target = index + offset;
	const outside = target < 0 || target >= draft.lanes.length;
	if (index < 0 || outside) return draft;
	const lanes = [...draft.lanes];
	const [moved] = lanes.splice(index, 1);
	lanes.splice(target, 0, defined(moved));
	return { ...draft, lanes };
}

/** A removed lane that held content sends it to the first remaining lane until chosen otherwise. */
export function removeLane(draft: LanesDraft, id: string): LanesDraft {
	const lanes = draft.lanes.filter((lane) => lane.id !== id);
	const first = lanes[0];
	if (first === undefined) return { ...draft, lanes, transfers: {} };
	const transfers = { ...draft.transfers };
	const held = draft.existing.find((lane) => lane.id === id);
	const heldContent = held !== undefined && held.count > 0;
	if (heldContent) transfers[id] = first.id;
	for (const [removed, target] of Object.entries(transfers))
		if (!lanes.some((lane) => lane.id === target)) transfers[removed] = first.id;
	return { ...draft, lanes, transfers };
}

export function transferLane(draft: LanesDraft, removedId: string, targetId: string): LanesDraft {
	return { ...draft, transfers: { ...draft.transfers, [removedId]: targetId } };
}

export function disableLanes(draft: LanesDraft): LanesDraft {
	return { ...draft, lanes: [], transfers: {} };
}

/** Removed lanes whose content still needs a destination, in document order. */
export function pendingTransfers(draft: LanesDraft): readonly {
	readonly lane: LaneDraftEntry & { readonly count: number };
	readonly target: string;
}[] {
	if (draft.lanes.length === 0) return [];
	return draft.existing.flatMap((lane) => {
		if (lane.count === 0 || draft.lanes.some(({ id }) => id === lane.id)) return [];
		return [{ lane, target: draft.transfers[lane.id] ?? defined(draft.lanes[0]).id }];
	});
}

export function submittableLanes(draft: LanesDraft): boolean {
	return draft.lanes.every((lane) => lane.label.trim() !== '');
}

/** Fresh sequential keys: the dialog's order is the reading order. */
export function draftRootLanes(draft: LanesDraft): SharedRootLanes | undefined {
	if (draft.lanes.length === 0) return undefined;
	const lanes: LayoutLane[] = [];
	let previous: string | undefined;
	for (const lane of draft.lanes) {
		const slot: { before?: string } = {};
		if (previous !== undefined) slot.before = previous;
		const layoutOrder = fractionalOrderKeySpace.keyFor(slot);
		lanes.push({ id: lane.id, label: lane.label.trim(), layoutOrder });
		previous = layoutOrder;
	}
	return { laneOrientation: draft.orientation, lanes };
}

export function draftTransfers(draft: LanesDraft): Readonly<Record<string, string>> {
	return Object.fromEntries(pendingTransfers(draft).map(({ lane, target }) => [lane.id, target]));
}

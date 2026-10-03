/** A drop this close to a group's edge, or on its header, connects instead of moving. */
export const CONNECTION_BAND = 16;

export enum DropKind {
	Connect = 'connect',
	Move = 'move',
	Refused = 'refused',
}

/** Why releasing here would do nothing; the label says so before the author lets go. */
export enum DropRefusal {
	/** The relation would close a cycle. */
	Cycle = 'cycle',
	/** The same relation already exists. */
	Duplicate = 'duplicate',
	/** A dragged group would enter one of its own subgroups. */
	Descendant = 'descendant',
	/** The document refuses the relation for another reason. */
	Invalid = 'invalid',
}

interface ConnectDrop {
	readonly kind: DropKind.Connect;
	readonly to: string;
}

interface MoveDrop {
	readonly kind: DropKind.Move;
	readonly ids: readonly string[];
	readonly groupId?: string;
}

interface RefusedDrop {
	readonly kind: DropKind.Refused;
	readonly reason: DropRefusal;
	/** The endpoint the refused relation or move aimed at. */
	readonly to: string;
}

export type DropPlan = ConnectDrop | MoveDrop | RefusedDrop;

interface ClientBounds {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
}

/** The endpoint under the pointer; `band` says the pointer is on a group's header or inner band. */
export interface DropCandidate {
	readonly id: string;
	readonly group: boolean;
	readonly band: boolean;
}

export interface DropContext {
	/** The endpoint the drag started from. */
	readonly from: string;
	/** Selected endpoints; the dragged element carries them all when it belongs to them. */
	readonly selected: readonly string[];
	/** The direct container of an endpoint, `undefined` at the root. */
	readonly containerOf: (id: string) => string | undefined;
	/** Why the document would refuse the relation `from → to`, `undefined` when it accepts it. */
	readonly refuseConnection: (from: string, to: string) => DropRefusal | undefined;
}

function contains(bounds: ClientBounds, x: number, y: number): boolean {
	const horizontally = x >= bounds.left && x <= bounds.right;
	const vertically = y >= bounds.top && y <= bounds.bottom;
	return horizontally && vertically;
}

export function insideConnectionBand(
	bounds: ClientBounds,
	header: ClientBounds | undefined,
	x: number,
	y: number,
): boolean {
	if (header !== undefined && contains(header, x, y)) return true;
	const interior = {
		left: bounds.left + CONNECTION_BAND,
		top: bounds.top + CONNECTION_BAND,
		right: bounds.right - CONNECTION_BAND,
		bottom: bounds.bottom - CONNECTION_BAND,
	};
	return !contains(interior, x, y);
}

function encloses(context: DropContext, groupId: string, id: string): boolean {
	const visited: string[] = [];
	let parent = context.containerOf(id);
	while (parent !== undefined && !visited.includes(parent)) {
		if (parent === groupId) return true;
		visited.push(parent);
		parent = context.containerOf(parent);
	}
	return false;
}

function draggedIds(context: DropContext): readonly string[] {
	if (context.selected.includes(context.from)) return context.selected;
	return [context.from];
}

/** Elements already in the container stay; a group never enters itself or a descendant. */
function movable(context: DropContext, id: string, groupId: string | undefined): boolean {
	if (context.containerOf(id) === groupId) return false;
	if (groupId === undefined) return true;
	return id !== groupId && !encloses(context, id, groupId);
}

/**
 * Nothing to move is no refusal, except a group aiming at one of its subgroups: hovering an
 * element's own container, or a group's own interior, says nothing.
 */
function move(
	context: DropContext,
	groupId: string | undefined,
): MoveDrop | RefusedDrop | undefined {
	const dragged = draggedIds(context);
	const ids = dragged.filter((id) => movable(context, id, groupId));
	if (groupId === undefined) {
		if (ids.length === 0) return undefined;
		return { kind: DropKind.Move, ids };
	}
	if (ids.length > 0) return { kind: DropKind.Move, ids, groupId };
	if (dragged.some((id) => id !== groupId && encloses(context, id, groupId)))
		return { kind: DropKind.Refused, reason: DropRefusal.Descendant, to: groupId };
	return undefined;
}

/**
 * A node, a junction, a group's header or its inner band connect from the dragged element,
 * unless the group already encloses it or the document would refuse the relation. A group's
 * interior moves the dragged elements into it; the canvas background (`candidate` undefined)
 * returns them to the root.
 */
export function planDrop(
	context: DropContext,
	candidate: DropCandidate | undefined,
): DropPlan | undefined {
	if (candidate === undefined) return move(context, undefined);
	if (candidate.group && !candidate.band) return move(context, candidate.id);
	if (candidate.id === context.from || encloses(context, candidate.id, context.from))
		return undefined;
	const reason = context.refuseConnection(context.from, candidate.id);
	if (reason !== undefined) return { kind: DropKind.Refused, reason, to: candidate.id };
	return { kind: DropKind.Connect, to: candidate.id };
}

import {
	GroupState,
	type LogicDocument,
	type LogicEndpoint,
	type LogicRelation,
	type NewLogicNode,
} from '../../../../lib/core/document/logic-document';
import { EntityKind, type EntityRef } from './canvas-entity';
import { rootLanes } from './root-lanes';

/**
 * Where a new box goes: a root, optionally inside a group or beside the selection, or attached
 * to a selected endpoint.
 */
export interface NodeCreationRequest {
	/** The group whose background was double-clicked. */
	readonly groupId?: string | undefined;
	/** The root lane whose background was double-clicked. */
	readonly laneId?: string | undefined;
	/** The selected endpoint the box is attached to; it also decides the group. */
	readonly target?: EntityRef | undefined;
	/** The selection a root box stands beside: it only lends its lane; no relation, no group. */
	readonly near?: EntityRef | undefined;
}

/** The box as it starts out, and the relations created with it. */
export interface NodeCreationPlan {
	readonly node: NewLogicNode;
	readonly relations: readonly LogicRelation[];
}

interface NodeCreationOptions {
	readonly nodeId: string;
	readonly relationId: () => string;
	/** The nature chosen for new boxes; the first one stands in when it is missing. */
	readonly natureId?: string | undefined;
}

function selectedEndpoint(document: LogicDocument, target: EntityRef): LogicEndpoint | undefined {
	if (target.kind === EntityKind.Node) return document.nodes.find(({ id }) => id === target.id);
	if (target.kind === EntityKind.Group) return document.groups.find(({ id }) => id === target.id);
	if (target.kind === EntityKind.Junction)
		return document.junctions.find(({ id }) => id === target.id);
	return undefined;
}

function natureFor(document: LogicDocument, natureId: string | undefined): string | undefined {
	if (document.natures.some(({ id }) => id === natureId)) return natureId;
	return document.natures[0]?.id;
}

/** Whether the group, or one of its containers, is folded: a box typed there would not show. */
function folded(document: LogicDocument, groupId: string): boolean {
	const visited: string[] = [];
	let current: string | undefined = groupId;
	while (current !== undefined && !visited.includes(current)) {
		const id: string = current;
		visited.push(id);
		const group = document.groups.find((candidate) => candidate.id === id);
		if (group?.state === GroupState.Closed) return true;
		current = group?.groupId;
	}
	return false;
}

/** The lane an endpoint sits in: its own, or its outermost group's. */
function inheritedLane(document: LogicDocument, endpoint: LogicEndpoint): string | undefined {
	let current: LogicEndpoint | undefined = endpoint;
	const visited: string[] = [];
	while (current?.groupId !== undefined && !visited.includes(current.groupId)) {
		const parentId: string = current.groupId;
		visited.push(parentId);
		current = document.groups.find(({ id }) => id === parentId);
	}
	return current?.laneId;
}

/** A top-level box needs a root lane: the requested one, the target's, else the first by order. */
function laneFor(
	document: LogicDocument,
	request: NodeCreationRequest,
	target: LogicEndpoint | undefined,
): string | undefined {
	const lanes = rootLanes(document).map(({ id }) => id);
	if (lanes.length === 0) return undefined;
	if (request.laneId !== undefined && lanes.includes(request.laneId)) return request.laneId;
	if (target !== undefined) {
		const inherited = inheritedLane(document, target);
		if (inherited !== undefined && lanes.includes(inherited)) return inherited;
	}
	return lanes[0];
}

function nearEndpoint(
	document: LogicDocument,
	request: NodeCreationRequest,
): LogicEndpoint | undefined {
	if (request.near === undefined) return undefined;
	return selectedEndpoint(document, request.near);
}

/**
 * Resolves graph parentage independently from group containment. Returns `undefined` when the
 * document has no nature, the target is gone, or the box would land in a folded group.
 */
export function planNodeCreation(
	document: LogicDocument,
	request: NodeCreationRequest,
	options: NodeCreationOptions,
): NodeCreationPlan | undefined {
	let target: LogicEndpoint | undefined;
	if (request.target !== undefined) {
		target = selectedEndpoint(document, request.target);
		if (target === undefined) return undefined;
	}
	const natureId = natureFor(document, options.natureId);
	if (natureId === undefined) return undefined;
	const node: NewLogicNode = { id: options.nodeId, natureId, markdown: '' };
	const groupId = target?.groupId ?? request.groupId;
	if (groupId !== undefined && folded(document, groupId)) return undefined;
	let containedNode = node;
	if (groupId !== undefined) containedNode = { ...node, groupId };
	else {
		const laneId = laneFor(document, request, target ?? nearEndpoint(document, request));
		if (laneId !== undefined) containedNode = { ...node, laneId };
	}
	if (target === undefined) return { node: containedNode, relations: [] };
	return {
		node: containedNode,
		relations: [{ id: options.relationId(), from: options.nodeId, to: target.id }],
	};
}

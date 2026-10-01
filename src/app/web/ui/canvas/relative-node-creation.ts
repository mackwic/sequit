import type {
	LogicDocument,
	LogicEndpoint,
	LogicRelation,
	NewLogicNode,
} from '../../../../lib/core/document/logic-document';
import { EndpointKind } from '../../../../lib/core/document/logic-document';
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
	/** A sibling shares the target's parents instead of pointing to the target. */
	readonly sibling?: boolean | undefined;
}

/** The defaults the dialog starts from and the relations created with the box. */
export interface NodeCreationPlan {
	readonly node: NewLogicNode;
	readonly relations: readonly LogicRelation[];
}

interface NodeCreationOptions {
	readonly nodeId: string;
	readonly relationId: () => string;
	readonly lastNatureId?: string | undefined;
}

function selectedEndpoint(document: LogicDocument, target: EntityRef): LogicEndpoint | undefined {
	if (target.kind === EntityKind.Node) return document.nodes.find(({ id }) => id === target.id);
	if (target.kind === EntityKind.Group) return document.groups.find(({ id }) => id === target.id);
	if (target.kind === EntityKind.Junction)
		return document.junctions.find(({ id }) => id === target.id);
	return undefined;
}

function natureFor(
	document: LogicDocument,
	target: LogicEndpoint | undefined,
	lastNatureId: string | undefined,
): string | undefined {
	if (target?.kind === EndpointKind.Node) return target.natureId;
	if (document.natures.some(({ id }) => id === lastNatureId)) return lastNatureId;
	return document.natures[0]?.id;
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
 * document has no nature or the target is gone.
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
	const natureId = natureFor(document, target, options.lastNatureId);
	if (natureId === undefined) return undefined;
	const node: NewLogicNode = { id: options.nodeId, natureId, markdown: '' };
	const groupId = target?.groupId ?? request.groupId;
	let containedNode = node;
	if (groupId !== undefined) containedNode = { ...node, groupId };
	else {
		const laneId = laneFor(document, request, target ?? nearEndpoint(document, request));
		if (laneId !== undefined) containedNode = { ...node, laneId };
	}
	if (target === undefined) return { node: containedNode, relations: [] };
	let parents = [target.id];
	if (request.sibling === true)
		parents = document.relations.filter(({ from }) => from === target.id).map(({ to }) => to);
	return {
		node: containedNode,
		relations: parents.map((parentId) => ({
			id: options.relationId(),
			from: options.nodeId,
			to: parentId,
		})),
	};
}

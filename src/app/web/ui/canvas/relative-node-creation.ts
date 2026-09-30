import type {
	LogicDocument,
	LogicEndpoint,
	LogicRelation,
	NewLogicNode,
} from '../../../../lib/core/document/logic-document';
import { EndpointKind } from '../../../../lib/core/document/logic-document';
import { EntityKind, type EntityRef } from './canvas-entity';

/** Where a new box goes: a root, optionally inside a group, or attached to a selected endpoint. */
export interface NodeCreationRequest {
	/** The group whose background was double-clicked. */
	readonly groupId?: string | undefined;
	/** The selected endpoint the box is attached to; it also decides the group. */
	readonly target?: EntityRef | undefined;
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

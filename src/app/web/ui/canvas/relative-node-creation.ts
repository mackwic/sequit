import type {
	LogicDocument,
	LogicEndpoint,
	LogicRelation,
	NewLogicNode,
} from '../../../../lib/core/document/logic-document';
import { EndpointKind } from '../../../../lib/core/document/logic-document';
import { EntityKind, type EntityRef } from './canvas-entity';

export enum RelativeNodePosition {
	Child = 'child',
	Sibling = 'sibling',
}

export interface RelativeNodeCreationPlan {
	readonly node: NewLogicNode;
	readonly relations: readonly LogicRelation[];
}

interface RelativeNodeCreationOptions {
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
	target: LogicEndpoint,
	lastNatureId: string | undefined,
): string | undefined {
	if (target.kind === EndpointKind.Node) return target.natureId;
	if (document.natures.some(({ id }) => id === lastNatureId)) return lastNatureId;
	return document.natures[0]?.id;
}

/** Resolves graph parentage independently from group containment. */
export function planRelativeNodeCreation(
	document: LogicDocument,
	targetRef: EntityRef,
	position: RelativeNodePosition,
	options: RelativeNodeCreationOptions,
): RelativeNodeCreationPlan | undefined {
	const target = selectedEndpoint(document, targetRef);
	if (target === undefined) return undefined;
	const natureId = natureFor(document, target, options.lastNatureId);
	if (natureId === undefined) return undefined;

	const node: NewLogicNode = {
		id: options.nodeId,
		natureId,
		markdown: '',
	};
	let containedNode = node;
	if (target.groupId !== undefined) containedNode = { ...node, groupId: target.groupId };
	let parents = [target.id];
	if (position === RelativeNodePosition.Sibling)
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

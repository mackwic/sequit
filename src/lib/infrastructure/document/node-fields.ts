import {
	contentStyleFields,
	type LogicNode,
	type NewLogicNode,
	nodeDescriptionFields,
} from '../../core/document/logic-document';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	SharedProperty,
} from './shared-document-command';

/** What an author edits in the box dialog; `''` for description, color or icon means none. */
export interface NodeFields {
	readonly natureId: string;
	readonly markdown: string;
	readonly description: string;
	readonly color: string;
	readonly icon: string;
}

const NODE_STYLE_PROPERTIES = [SharedProperty.Color, SharedProperty.Icon] as const;
type NodeStyleProperty = (typeof NODE_STYLE_PROPERTIES)[number];

export function nodeFields(
	node: Pick<
		LogicNode,
		| SharedProperty.NatureId
		| SharedProperty.Markdown
		| SharedProperty.Description
		| SharedProperty.Color
		| SharedProperty.Icon
	>,
): NodeFields {
	return {
		natureId: node.natureId,
		markdown: node.markdown,
		description: node.description ?? '',
		color: node.color ?? '',
		icon: node.icon ?? '',
	};
}

export function newNodeFrom(id: string, fields: NodeFields, groupId?: string): NewLogicNode {
	const node: NewLogicNode = {
		id,
		natureId: fields.natureId,
		markdown: fields.markdown,
		...nodeDescriptionFields(fields.description),
		...contentStyleFields(fields.color || undefined, fields.icon || undefined),
	};
	if (groupId === undefined) return node;
	return { ...node, groupId };
}

/**
 * The property changes between two field sets, or `undefined` when none. Markdown and description
 * are texts: they never travel here, callers splice them in place.
 */
export function nodeUpdate(
	nodeId: string,
	before: NodeFields,
	after: NodeFields,
): SharedDocumentCommand | undefined {
	const set: Partial<Record<NodeStyleProperty | SharedProperty.NatureId, string>> = {};
	const unset: NodeStyleProperty[] = [];
	if (before.natureId !== after.natureId) set.natureId = after.natureId;
	for (const field of NODE_STYLE_PROPERTIES) {
		if (before[field] === after[field]) continue;
		if (after[field] === '') unset.push(field);
		else set[field] = after[field];
	}
	if (Object.keys(set).length === 0 && unset.length === 0) return undefined;
	return {
		op: SharedCommandKind.Update,
		target: { kind: SharedElementKind.Node, id: nodeId },
		set,
		unset,
	};
}

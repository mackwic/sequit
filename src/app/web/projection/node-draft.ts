import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import type {
	LogicDocument,
	LogicRelation,
	NewLogicNode,
} from '../../../lib/core/document/logic-document';
import {
	projectNodeAddition,
	projectRelationAddition,
} from '../../../lib/core/document/topology-edits';
import { fractionalOrderKeySpace } from '../../../lib/core/ordering/order-key-space';

/** A box typed on the canvas: it stays in this view until its creation is accepted. */
export interface NodeDraft {
	readonly node: NewLogicNode;
	readonly relations: readonly LogicRelation[];
}

/** The text of an existing box typed in place: measured as typed, saved when the box is left. */
export interface NodeTextDraft {
	readonly nodeId: string;
	readonly markdown: string;
}

/** What the canvas draws that the document does not hold yet. */
export interface CanvasDrafts {
	readonly nodes: readonly NodeDraft[];
	readonly texts: readonly NodeTextDraft[];
}

export const NO_CANVAS_DRAFTS: CanvasDrafts = { nodes: [], texts: [] };

/**
 * A shared document lists its nodes by identifier: the draft is listed where its box will be, so
 * that the box is not moved, and does not lose focus, once created.
 */
function listedInPlace(document: LogicDocument, nodeId: string): LogicDocument {
	const others = document.nodes.filter(({ id }) => id !== nodeId);
	const drafted = document.nodes.find(({ id }) => id === nodeId);
	const index = others.findIndex(({ id }) => compareCanonicalStrings(id, nodeId) > 0);
	if (drafted === undefined || index < 0) return document;
	const nodes = [...others];
	nodes.splice(index, 0, drafted);
	return { ...document, nodes };
}

function withNodeDraft(document: LogicDocument, draft: NodeDraft): LogicDocument | undefined {
	const added = projectNodeAddition(document, draft.node, fractionalOrderKeySpace);
	if (!added.ok) return undefined;
	let current = listedInPlace(added.value.document, draft.node.id);
	for (const relation of draft.relations) {
		const connected = projectRelationAddition(current, relation, fractionalOrderKeySpace);
		if (!connected.ok) return undefined;
		current = connected.value.document;
	}
	return current;
}

/**
 * Places the drafts as the shared command rules will create them, so that a box keeps its place
 * once accepted. A draft whose box the document already holds, or that no longer fits, is skipped.
 */
export function withNodeDrafts(
	document: LogicDocument,
	drafts: readonly NodeDraft[],
): LogicDocument {
	let current = document;
	for (const draft of drafts) {
		if (document.nodes.some(({ id }) => id === draft.node.id)) continue;
		current = withNodeDraft(current, draft) ?? current;
	}
	return current;
}

/** The document as drawn: new boxes placed, and the texts being typed in existing ones. */
export function withDrafts(document: LogicDocument, drafts: CanvasDrafts): LogicDocument {
	const placed = withNodeDrafts(document, drafts.nodes);
	if (drafts.texts.length === 0) return placed;
	const texts = new Map(drafts.texts.map(({ nodeId, markdown }) => [nodeId, markdown]));
	return {
		...placed,
		nodes: placed.nodes.map((node) => {
			const markdown = texts.get(node.id);
			if (markdown === undefined) return node;
			return { ...node, markdown };
		}),
	};
}

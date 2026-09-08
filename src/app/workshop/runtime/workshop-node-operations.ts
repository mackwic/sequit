import {
	contentStyleFields,
	defined,
	type LogicDocument,
	type NewLogicNode,
} from '../../../lib/core/document/logic-document';
import {
	projectNodeAddition,
	projectRelationAddition,
} from '../../../lib/core/document/topology-edits';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import { orderEndpoints } from '../../../lib/core/ordering/endpoint-order';
import { fractionalOrderKeySpace } from '../../../lib/core/ordering/order-key-space';

/** Compose the product projections before committing, so failure and undo are atomic. */
export function addWorkshopNode(
	document: LogicDocument,
	node: NewLogicNode,
	link?: { readonly id: string; readonly from: string },
): LogicDocument {
	const added = projectNodeAddition(document, node, fractionalOrderKeySpace);
	if (!added.ok) throw new Error(added.diagnostics.map(({ message }) => message).join('; '));
	if (link === undefined) return added.value.document;
	const connected = projectRelationAddition(
		added.value.document,
		{ ...link, to: node.id },
		fractionalOrderKeySpace,
	);
	if (!connected.ok)
		throw new Error(connected.diagnostics.map(({ message }) => message).join('; '));
	return connected.value.document;
}

export function duplicateWorkshopNodes(
	document: LogicDocument,
	copies: readonly { readonly sourceId: string; readonly id: string }[],
): LogicDocument {
	return copies.reduce((current, copy) => {
		const original = defined(
			document.nodes.find(({ id }) => id === copy.sourceId),
			'Boîte introuvable.',
		);
		let node: NewLogicNode = {
			id: copy.id,
			natureId: original.natureId,
			markdown: original.markdown,
			...contentStyleFields(original.color, original.icon),
		};
		if (original.groupId !== undefined) node = { ...node, groupId: original.groupId };
		return addWorkshopNode(current, node);
	}, document);
}

export function removeWorkshopNodes(
	document: LogicDocument,
	ids: ReadonlySet<string>,
): LogicDocument {
	return {
		...document,
		nodes: document.nodes.filter(({ id }) => !ids.has(id)),
		relations: document.relations.filter(({ from, to }) => !ids.has(from) && !ids.has(to)),
	};
}

/** Order only peers in the same group and topological rank; dependencies still win. */
export function placeWorkshopNodeFirst(document: LogicDocument, id: string): LogicDocument {
	const node = defined(
		document.nodes.find((item) => item.id === id),
		'Boîte introuvable.',
	);
	const graph = createGraph(document);
	if (!graph.ok) throw new Error(graph.diagnostics.map(({ message }) => message).join('; '));
	const ranks = topologicallyRank(graph.value).byEndpointId;
	const peers = document.nodes.filter(
		(item) => item.groupId === node.groupId && ranks.get(item.id) === ranks.get(id),
	);
	const firstId = orderEndpoints(peers, fractionalOrderKeySpace)[0];
	const first = defined(peers.find((item) => item.id === firstId));
	if (first.id === id) return document;
	const layoutOrder = fractionalOrderKeySpace.keyFor({ after: first.layoutOrder }, id);
	return {
		...document,
		nodes: document.nodes.map((item) => {
			if (item.id === id) return { ...item, layoutOrder };
			return item;
		}),
	};
}

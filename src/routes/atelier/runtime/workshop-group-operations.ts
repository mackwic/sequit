import { defined, EndpointKind, type LogicDocument } from '../../../lib/document/logic-document';
import { fractionalOrderKeySpace } from '../../../lib/layout/order-key-space';

export function groupWorkshopNodes(
	document: LogicDocument,
	group: { readonly id: string; readonly label: string },
	ids: ReadonlySet<string>,
): LogicDocument {
	return {
		...document,
		groups: [
			...document.groups,
			{
				...group,
				kind: EndpointKind.Group,
				layoutOrder: fractionalOrderKeySpace.keyFor({}, group.id),
			},
		],
		nodes: document.nodes.map((node) => {
			if (ids.has(node.id)) return { ...node, groupId: group.id };
			return node;
		}),
	};
}

export function changeWorkshopMembership(
	document: LogicDocument,
	groupId: string,
	ids: ReadonlySet<string>,
	add: boolean,
): LogicDocument {
	defined(
		document.groups.find(({ id }) => id === groupId),
		'Groupe introuvable.',
	);
	return {
		...document,
		nodes: document.nodes.map((node) => {
			if (!ids.has(node.id)) return node;
			if (add) return { ...node, groupId };
			if (node.groupId !== groupId) return node;
			const result = { ...node };
			delete result.groupId;
			return result;
		}),
	};
}

export function dissolveWorkshopGroup(document: LogicDocument, id: string): LogicDocument {
	const group = defined(
		document.groups.find((item) => item.id === id),
		'Groupe introuvable.',
	);
	const ungroup = <T extends { groupId?: string }>(item: T): T => {
		if (item.groupId !== id) return item;
		const result = { ...item };
		delete result.groupId;
		if (group.groupId !== undefined) result.groupId = group.groupId;
		return result;
	};
	return {
		...document,
		groups: document.groups.filter((item) => item.id !== id).map(ungroup),
		nodes: document.nodes.map(ungroup),
		junctions: document.junctions.map(ungroup),
		relations: document.relations.filter((item) => item.from !== id && item.to !== id),
	};
}

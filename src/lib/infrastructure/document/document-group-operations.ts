import {
	defined,
	EndpointKind,
	type LogicDocument,
	type LogicGroup,
} from '../../core/document/logic-document';
import { fractionalOrderKeySpace } from '../../core/ordering/order-key-space';

export function groupDocumentNodes(
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

export function groupSiblingDocumentNodes(
	document: LogicDocument,
	group: { readonly id: string; readonly label: string },
	ids: ReadonlySet<string>,
): LogicDocument {
	if (ids.size === 0) throw new Error('Sélectionnez les nœuds à regrouper.');
	const members = [...ids].map((id) =>
		defined(
			document.nodes.find((node) => node.id === id),
			`Nœud introuvable : ${id}`,
		),
	);
	const parent = members[0]?.groupId;
	if (members.some((member) => member.groupId !== parent))
		throw new Error('Les nœuds doivent appartenir au même groupe.');
	if (
		[...document.groups, ...document.nodes, ...document.junctions].some(
			(endpoint) => endpoint.id === group.id,
		)
	)
		throw new Error(`Cet identifiant existe déjà : ${group.id}`);
	const grouped = groupDocumentNodes(document, group, ids);
	if (parent === undefined) return grouped;
	return {
		...grouped,
		groups: grouped.groups.map((candidate): LogicGroup => {
			if (candidate.id !== group.id) return candidate;
			return { ...candidate, groupId: parent };
		}),
	};
}

export function changeDocumentMembership(
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

export function dissolveDocumentGroup(document: LogicDocument, id: string): LogicDocument {
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

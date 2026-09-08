import {
	contentStyleFields,
	defined,
	type LogicDocument,
	type LogicNature,
} from '../../../lib/core/document/logic-document';

export function saveWorkshopNature(document: LogicDocument, nature: LogicNature): LogicDocument {
	return {
		...document,
		natures: [
			...document.natures.filter(({ id }) => id !== nature.id),
			{
				id: nature.id,
				label: nature.label,
				color: nature.color,
				...contentStyleFields(undefined, nature.icon),
			},
		],
	};
}

export function assignWorkshopNature(
	document: LogicDocument,
	natureId: string,
	ids: ReadonlySet<string>,
): LogicDocument {
	defined(
		document.natures.find(({ id }) => id === natureId),
		'Nature introuvable.',
	);
	return {
		...document,
		nodes: document.nodes.map((node) => {
			if (ids.has(node.id)) return { ...node, natureId };
			return node;
		}),
	};
}

export function removeWorkshopNature(
	document: LogicDocument,
	id: string,
	replacementId: string,
): LogicDocument {
	defined(
		document.natures.find((nature) => nature.id === id),
		'Nature introuvable.',
	);
	if (id === replacementId)
		throw new Error('Choisissez une autre nature pour les boîtes concernées.');
	const reassigned = assignWorkshopNature(
		document,
		replacementId,
		new Set(document.nodes.filter((node) => node.natureId === id).map((node) => node.id)),
	);
	return { ...reassigned, natures: reassigned.natures.filter((nature) => nature.id !== id) };
}

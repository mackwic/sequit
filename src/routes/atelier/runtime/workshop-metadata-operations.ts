import {
	defined,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../lib/document/logic-document';

export function renameWorkshopDocument(document: LogicDocument, title: string): LogicDocument {
	return { ...document, title };
}

export function emptyWorkshopDocument(document: LogicDocument, id: string): LogicDocument {
	return {
		...document,
		id,
		title: 'Sans titre',
		nodes: [],
		groups: [],
		junctions: [],
		relations: [],
	};
}

export function arrangeWorkshopDocument(
	document: LogicDocument,
	direction: LayoutDirection,
): LogicDocument {
	let bias = LayoutBias.Top;
	if (direction === LayoutDirection.LeftToRight || direction === LayoutDirection.RightToLeft)
		bias = LayoutBias.Left;
	return { ...document, layout: defined(layoutConfiguration(direction, bias)) };
}

export function renameWorkshopGroup(
	document: LogicDocument,
	id: string,
	label: string,
): LogicDocument {
	defined(
		document.groups.find((group) => group.id === id),
		'Groupe introuvable.',
	);
	return {
		...document,
		groups: document.groups.map((group) => {
			if (group.id === id) return { ...group, label };
			return group;
		}),
	};
}

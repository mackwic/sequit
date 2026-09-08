import {
	type ContentStyle,
	contentStyleFields,
	defined,
	type LogicDocument,
	type LogicNode,
} from './logic-document';

/** Replace only presentation properties; omitted values restore inheritance. */
export function styleDocumentNode(
	document: LogicDocument,
	id: string,
	style: ContentStyle,
): LogicDocument {
	defined(
		document.nodes.find((node) => node.id === id),
		`Unknown node: ${id}`,
	);
	return {
		...document,
		nodes: document.nodes.map((node) => {
			if (node.id !== id) return node;
			const styled: { -readonly [K in keyof LogicNode]: LogicNode[K] } = { ...node };
			delete styled.color;
			delete styled.icon;
			return { ...styled, ...contentStyleFields(style.color, style.icon) };
		}),
	};
}

/** A nature owns its base color. Its icon inherits the main theme's absence of an icon. */
export function styleDocumentNature(
	document: LogicDocument,
	id: string,
	style: ContentStyle,
): LogicDocument {
	defined(
		document.natures.find((nature) => nature.id === id),
		`Unknown nature: ${id}`,
	);
	return {
		...document,
		natures: document.natures.map((nature) => {
			if (nature.id !== id) return nature;
			return {
				id: nature.id,
				label: nature.label,
				color: style.color ?? nature.color,
				...contentStyleFields(undefined, style.icon),
			};
		}),
	};
}

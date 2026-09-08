import {
	defined,
	EndpointKind,
	JunctionOperator,
	type LogicDocument,
	type LogicRelation,
} from '../../../lib/document/logic-document';
import { fractionalOrderKeySpace } from '../../../lib/layout/order-key-space';

export function retargetWorkshopRelation(
	document: LogicDocument,
	relation: LogicRelation,
): LogicDocument {
	defined(
		document.relations.find(({ id }) => id === relation.id),
		'Relation introuvable.',
	);
	return {
		...document,
		relations: document.relations.map((item) => {
			if (item.id === relation.id) return { ...item, from: relation.from, to: relation.to };
			return item;
		}),
	};
}

export function removeWorkshopRelation(document: LogicDocument, id: string): LogicDocument {
	return { ...document, relations: document.relations.filter((item) => item.id !== id) };
}

export interface WorkshopConvergence {
	readonly id: string;
	readonly first: string;
	readonly second: string;
	readonly target: string;
}

export function createWorkshopConvergence(
	document: LogicDocument,
	{ id, first, second, target }: WorkshopConvergence,
): LogicDocument {
	if (new Set([first, second, target]).size < 3)
		throw new Error('Choisissez trois boîtes distinctes.');
	return {
		...document,
		junctions: [
			...document.junctions,
			{
				kind: EndpointKind.Junction,
				id,
				operator: JunctionOperator.Xor,
				layoutOrder: fractionalOrderKeySpace.keyFor({}),
			},
		],
		relations: [
			...document.relations.filter(
				(item) => !((item.from === first || item.from === second) && item.to === target),
			),
			{ id: `${id}-a`, from: first, to: id },
			{ id: `${id}-b`, from: second, to: id },
			{ id: `${id}-c`, from: id, to: target },
		],
	};
}

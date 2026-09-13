import {
	EndpointKind,
	GroupState,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';

export enum CollaborativeFixture {
	TwoBoxes = 'two-boxes',
	LinkedBoxes = 'linked-boxes',
	OpenGroup = 'open-group',
}

export function collaborativeFixture(kind: CollaborativeFixture, room: string): LogicDocument {
	let document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: room,
		title: 'Deux boîtes',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'N', label: 'Action', color: '#00aa44' }],
		groups: [],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'A',
				natureId: 'N',
				markdown: 'Alpha',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 'B',
				natureId: 'N',
				markdown: 'Bravo',
				layoutOrder: orderKey('a1'),
			},
		],
		junctions: [],
		relations: [],
	};
	if (kind !== CollaborativeFixture.TwoBoxes)
		document = { ...document, relations: [{ id: 'R', from: 'B', to: 'A' }] };
	if (kind === CollaborativeFixture.OpenGroup)
		document = {
			...document,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'G',
					label: 'Groupe',
					state: GroupState.Expanded,
					layoutOrder: orderKey('a2'),
				},
			],
			nodes: document.nodes.map((node) => ({ ...node, groupId: 'G' })),
		};
	return document;
}

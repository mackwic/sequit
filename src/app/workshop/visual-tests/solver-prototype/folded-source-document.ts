import {
	EndpointKind,
	GroupState,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../lib/core/document/logic-document';
import { orderKey } from '../../../../lib/core/document/order-key';

interface FoldedSourceOptions {
	readonly layout: LogicDocument['layout'];
	readonly id: string;
	readonly title: string;
}

/** Source-valid B → x → A with A and B inside G, before any visible-owner collapse. */
export function foldedSourceDocument({ layout, id, title }: FoldedSourceOptions): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id,
		title,
		layout,
		natures: [{ id: 'task', label: 'Tâche', color: '#456858' }],
		groups: [
			{
				id: 'G',
				kind: EndpointKind.Group,
				label: 'G',
				state: GroupState.Closed,
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: [
			{
				id: 'A',
				kind: EndpointKind.Node,
				natureId: 'task',
				groupId: 'G',
				markdown: 'A',
				layoutOrder: orderKey('a1'),
			},
			{
				id: 'B',
				kind: EndpointKind.Node,
				natureId: 'task',
				groupId: 'G',
				markdown: 'B',
				layoutOrder: orderKey('a2'),
			},
			{
				id: 'x',
				kind: EndpointKind.Node,
				natureId: 'task',
				markdown: 'x',
				layoutOrder: orderKey('a3'),
			},
		],
		junctions: [],
		relations: [
			{ id: 'B-to-x', from: 'B', to: 'x' },
			{ id: 'x-to-A', from: 'x', to: 'A' },
		],
	};
}

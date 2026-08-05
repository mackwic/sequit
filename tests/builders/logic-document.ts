import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';

export function validLogicDocument(): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'valid-document',
		title: 'Valid document',
		layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'container',
				label: 'Container',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Group,
				id: 'endpoint-group',
				label: 'Endpoint group',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Group,
				id: 'orphan-group',
				label: 'Orphan group',
				layoutOrder: orderKey('a2'),
			},
		],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'source-a',
				natureId: 'goal',
				groupId: 'container',
				markdown: 'Source A\n',
				layoutOrder: orderKey('a3'),
			},
			{
				kind: EndpointKind.Node,
				id: 'source-b',
				natureId: 'goal',
				groupId: 'container',
				markdown: 'Source B\n',
				layoutOrder: orderKey('a4'),
			},
			{
				kind: EndpointKind.Node,
				id: 'target',
				natureId: 'goal',
				markdown: 'Target\n',
				layoutOrder: orderKey('a5'),
			},
			{
				kind: EndpointKind.Node,
				id: 'isolated',
				natureId: 'goal',
				markdown: 'Isolated\n',
				layoutOrder: orderKey('a6'),
			},
		],
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'choice',
				operator: JunctionOperator.Xor,
				groupId: 'container',
				layoutOrder: orderKey('a7'),
			},
		],
		relations: [
			{ id: 'a-to-choice', from: 'source-a', to: 'choice' },
			{ id: 'b-to-choice', from: 'source-b', to: 'choice' },
			{ id: 'choice-to-target', from: 'choice', to: 'target' },
			{ id: 'group-to-target', from: 'endpoint-group', to: 'target' },
		],
	};
}

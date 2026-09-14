import {
	EndpointKind,
	JunctionOperator,
	type LayoutConfiguration,
	type LogicDocument,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import { validLogicDocument } from '../builders/logic-document';

export function groupJunctionFixture(
	layout: LayoutConfiguration,
	groupAsTarget: boolean,
	nested: boolean,
): LogicDocument {
	const group = {
		kind: EndpointKind.Group as const,
		id: 'group',
		label: 'Group',
		layoutOrder: orderKey('a0'),
	};
	let groups: LogicDocument['groups'] = [group];
	if (nested) groups = [{ ...group, id: 'inner', groupId: 'group' }, group];
	let groupId = 'group';
	if (nested) groupId = 'inner';
	let relations = [
		{ id: 'group-junction', from: 'group', to: 'junction' },
		{ id: 'junction-node', from: 'junction', to: 'outside' },
	];
	if (groupAsTarget) relations = relations.map(({ id, from, to }) => ({ id, from: to, to: from }));
	return {
		...validLogicDocument(),
		layout,
		groups,
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'member',
				natureId: 'goal',
				markdown: 'Member',
				groupId,
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Node,
				id: 'outside',
				natureId: 'goal',
				markdown: 'Outside',
				layoutOrder: orderKey('a2'),
			},
		],
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'junction',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a3'),
			},
		],
		relations,
	};
}

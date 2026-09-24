import { EndpointKind, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { persistedNestedGridWithLaneCellDocument } from './nested-region-fixture';

/** An internal grid with an ordinary grouped cell beside a two-lane cell. */
export function nestedGridGroupLanesDocument(): LogicDocument {
	const source = persistedNestedGridWithLaneCellDocument();
	return {
		...source,
		groups: [
			...source.groups,
			{
				kind: EndpointKind.Group,
				id: 'c-group',
				label: 'Cell C group',
				regionId: 'c',
				layoutOrder: orderKey('a7'),
			},
		],
		nodes: source.nodes.map((node) => {
			if (node.id !== 'c') return node;
			const member = { ...node, groupId: 'c-group' };
			delete member.regionId;
			return member;
		}),
	};
}

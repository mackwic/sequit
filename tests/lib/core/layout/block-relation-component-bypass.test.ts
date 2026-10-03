import { it } from 'vitest';

import { EndpointKind, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { layoutDocument } from '../../../support/harnesses/layout';
import { axesFor } from '../../../support/harnesses/visual-directions';
import { VisualLayout } from '../../../support/harnesses/visual-layout';

const ids = ['a', 'b', 'c', 'd', 'z'] as const;
const nodeSizes = Object.fromEntries(ids.map((id) => [id, { width: 100, height: 60 }]));

it.each(LAYOUT_CONFIGURATIONS)(
	'recognizes a bypassed relation component beside an unconnected member in its block ($direction)',
	async (configuration) => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			layout: configuration,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'block',
					label: 'Block',
					layoutOrder: orderKey('a0'),
				},
			],
			nodes: ids.map((id, index) => ({
				kind: EndpointKind.Node,
				id,
				natureId: 'goal',
				markdown: id,
				groupId: 'block',
				layoutOrder: orderKey(`a${index + 1}`),
			})),
			junctions: [],
			relations: [
				{ id: 'b-to-a', from: 'b', to: 'a' },
				{ id: 'c-to-b', from: 'c', to: 'b' },
				{ id: 'd-to-c', from: 'd', to: 'c' },
				{ id: 'd-to-a', from: 'd', to: 'a' },
			],
		};
		const result = await layoutDocument(document, { nodes: nodeSizes });
		const layout = new VisualLayout(
			result.layout,
			result.ranks.byEndpointId,
			configuration.direction,
		);
		for (const id of ['b-to-a', 'c-to-b', 'd-to-c'])
			AssertLayout(layout).route(id).isStraightAlong(axesFor(configuration.direction).primary);
	},
);

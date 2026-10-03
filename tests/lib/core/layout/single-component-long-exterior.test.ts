import { expect, it } from 'vitest';

import {
	EndpointKind,
	type LogicDocument,
	type LogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import { layerPassages } from '../../../../src/lib/core/layout/routing/layer-passages';
import { validLogicDocument } from '../../../support/builders/logic-document';

const relation = { id: 'long', from: 'source', to: 'target' };
const document: LogicDocument = {
	...validLogicDocument(),
	nodes: ['target', 'middle', 'source'].map((id, index): LogicNode => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'goal',
		markdown: id,
		layoutOrder: orderKey(`a${index}`),
	})),
	groups: [],
	junctions: [],
	relations: [relation],
};

it('routes a long relation around its own component when the only column is blocked', () => {
	const created = createGraph(document);
	if (!created.ok) throw new Error('The single-component passage fixture must be valid.');
	const rows = [['target'], ['middle'], ['source']];
	const bounds = new Map<string, Bounds>([
		['target', { x: -40, y: 0, width: 80, height: 40 }],
		['middle', { x: -40, y: 120, width: 80, height: 40 }],
		['source', { x: -40, y: 240, width: 80, height: 40 }],
	]);
	const reserve = layerPassages({
		graph: created.value,
		layers: {
			rows,
			byId: new Map(rows.flatMap((row, index) => row.map((id) => [id, index] as const))),
			intervals: [],
		},
		bounds,
		vertical: true,
		componentByEndpointId: new Map([
			['target', 0],
			['middle', 0],
			['source', 0],
		]),
	});

	expect(reserve(relation)).toBe(64);
});

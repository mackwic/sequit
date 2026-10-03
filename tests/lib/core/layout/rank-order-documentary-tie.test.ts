import { expect, it } from 'vitest';

import {
	EndpointKind,
	type LogicDocument,
	type LogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { layoutWithDedicatedEngineAndRankOrderWitness } from '../../../../src/lib/core/layout/layout-engine';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

const targetIds = ['z-target', 'a-target', 'm-target'];
const sourceIds = ['z-source', 'a-source', 'm-source'];
const edges = [
	['z-source', 'z-target'],
	['z-source', 'a-target'],
	['z-source', 'm-target'],
	['a-source', 'z-target'],
	['a-source', 'a-target'],
	['m-source', 'z-target'],
] as const;
const document: LogicDocument = {
	...validLogicDocument(),
	nodes: [...targetIds, ...sourceIds].map((id, index): LogicNode => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'goal',
		markdown: id,
		layoutOrder: orderKey(`a${index}`),
	})),
	groups: [],
	junctions: [],
	relations: edges.map(([from, to], index) => ({ id: `r${index}`, from, to })),
};

it('breaks equal rank-search costs by documentary row position, not endpoint id', () => {
	const prepared = prepareLayoutDocument(document);
	const result = layoutWithDedicatedEngineAndRankOrderWitness(
		prepared.graph,
		prepared.ranks,
		prepared.measurements,
	);

	expect(result.witness.selectedOrder).toEqual([targetIds, ['m-source', 'a-source', 'z-source']]);
});

import { describe, it } from 'vitest';

import { AssertBox } from '../../../../src/app/workshop/visual-tests/assert-box';
import { centeredChain } from '../../../../src/app/workshop/visual-tests/scenarios/centered-chain.scenario';
import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { boundsFor, layoutDocument } from '../../../support/harnesses/layout';

function twoIndependentBoxes(): LogicDocument {
	return {
		...validLogicDocument(),
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		groups: [],
		junctions: [],
		nodes: ['a', 'b'].map((id, index) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'goal',
			markdown: id,
			layoutOrder: orderKey(`a${index}`),
		})),
		relations: [],
	};
}

describe('simple box alignment layouts (VL-505)', () => {
	it('aligns two independent boxes at their top edges with top bias', async () => {
		const { layout } = await layoutDocument(twoIndependentBoxes(), {
			nodes: { a: { width: 100, height: 60 }, b: { width: 200, height: 120 } },
		});
		AssertBox({ id: 'a', bounds: boundsFor(layout, 'a') }).isAlignedWith(
			{ id: 'b', bounds: boundsFor(layout, 'b') },
			{ by: 'top' },
		);
	});
	it('aligns the centers of a two-box chain with different widths', async () => {
		const layout = await centeredChain.arrange();
		centeredChain.assert(layout);
	});
});

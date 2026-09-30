import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

const BOX = { width: 220, height: 116 };

export const scenario: LayoutScenario = {
	id: 'shared-endpoint-rails',
	label: 'Les routes d’une même boîte ne se croisent pas entre elles',
	group: 'Convergences et croisements',
	order: 145,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			nodes: { a: BOX, b: BOX, c: BOX, d: BOX, e: BOX },
			relations: [
				{ id: 'b-c', from: 'b', to: 'c' },
				{ id: 'a-b', from: 'a', to: 'b' },
				{ id: 'a-c', from: 'a', to: 'c' },
				{ id: 'a-d', from: 'a', to: 'd' },
				{ id: 'a-e', from: 'a', to: 'e' },
				{ id: 'd-e', from: 'd', to: 'e' },
			],
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
		for (const element of layout.elements) {
			const family = layout.relations.filter(
				({ from, to }) => from === element.id || to === element.id,
			);
			if (family.length > 1) check.routes(family).haveNoCrossing();
		}
	},
};

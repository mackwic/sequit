import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { equalMetric, minimumMetric } from '../../../support/assertions/routing-measurements';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { gapAfter } from '../../../support/harnesses/box-geometry';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'blocked-family',
	label: 'Enfant bloqué contre la famille voisine',
	group: 'Centrage et alignement',
	order: 27,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({
			...graphFixtures
				.independentNodes(['r', 'a', 'b', 'c', 'd', 'c1', 'd1', 'a1', 'd2'])
				.successorsOf('r', ['a', 'b', 'c', 'd'])
				.successorsOf('a', ['a1'])
				.successorsOf('c', ['c1'])
				.successorsOf('d', ['d2', 'd1'])
				.build(),
			direction,
			bias,
		});
	},
	assert(layout) {
		const check = AssertLayout(layout);
		check.nodes(['a1', 'c1', 'd1', 'd2']).haveRank(3);
		check.envelope(['a', 'b', 'c', 'd']).isCenteredOn('r', { axis: 'transverse' });
		check.envelope(['a1']).isCenteredOn('a', { axis: 'transverse' });
		check.envelope(['d1', 'd2']).isCenteredOn('d', { axis: 'transverse' });
		check.node('c1').isAfter('a1', { direction: 'transverse-positive' });
		check.node('d1').isAfter('c1', { direction: 'transverse-positive' });
		let transverse = LayoutDirection.LeftToRight;
		if (axesFor(layout.direction).transverse === 'y') transverse = LayoutDirection.TopToBottom;
		const c1 = layout.getById('c1');
		equalMetric('C1 glisse contre D1', gapAfter(layout.getById('d1'), c1, transverse), 36, {
			boxes: ['c1', 'd1'],
		});
		// A negative gap from C1 to its parent C means that C1 still faces part of C.
		minimumMetric(
			'C1 reste face à son parent C',
			-gapAfter(layout.getById('c'), c1, transverse),
			1,
			{
				boxes: ['c1', 'c'],
			},
		);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
	},
};

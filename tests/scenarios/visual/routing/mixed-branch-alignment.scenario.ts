import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { minimumMetric } from '../../../support/assertions/routing-measurements';
import { mixedBranchAlignment } from '../../../support/fixtures/mixed-branch-alignment';
import { gapAfter } from '../../../support/harnesses/box-geometry';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

export const scenario: LayoutScenario = {
	id: 'mixed-branch-alignment',
	label: 'Branches mixtes et trajets droits',
	group: 'Rails et quais',
	order: 168,
	arrange(direction = LayoutDirection.TopToBottom, bias) {
		return layoutNodes({ ...mixedBranchAlignment(direction), direction, bias });
	},
	assert(layout) {
		const check = AssertLayout(layout);
		const parents = ['p', 'q', 's'];
		const children = ['u', 'v', 'w', 'g', 'x'];
		check.node('r').hasRank(1);
		check.nodes(parents).haveRank(2);
		check.nodes(children).haveRank(3);
		check.envelope(parents).isCenteredOn('r', { axis: 'transverse' });
		check.route('v-to-p').isStraightAlong(axesFor(layout.direction).primary);
		check.route('w-to-q').isStraightAlong(axesFor(layout.direction).primary);
		check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
		check.routes().haveNoCrossing().haveOnlyAllowedSharedTrunks();
		check.obstacles().haveClearance(24);
		let transverseDirection = LayoutDirection.LeftToRight;
		if (axesFor(layout.direction).transverse === 'y')
			transverseDirection = LayoutDirection.TopToBottom;
		for (const row of [parents, children]) {
			for (const [index, id] of row.entries()) {
				const previous = row[index - 1];
				if (previous === undefined) continue;
				minimumMetric(
					'Espacement entre voisins dans l’ordre documentaire',
					gapAfter(layout.getById(id), layout.getById(previous), transverseDirection),
					36,
					{ boxes: [previous, id] },
				);
			}
		}
	},
};

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { portPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import type { LayoutScenario } from '../scenario';

function variant(input: {
	readonly id: string;
	readonly label: string;
	readonly source: string;
	readonly target: string;
}): LayoutScenario {
	return {
		id: input.id,
		label: input.label,
		description:
			'Une relation croisée sépare son arrivée afin que les trois relations ne dessinent pas une quatrième relation inexistante.',
		group: 'Rails et ports',
		order: 250,
		arrange(direction = LayoutDirection.TopToBottom, bias) {
			return layoutNodes({
				...graphFixtures
					.routingNodes(['new-1', 'new-2', 'new-3', 'node-32', 'new-4', 'node-42'], direction, 180)
					.arrowsFrom('new-2', ['new-1'])
					.arrowsFrom('new-3', ['new-2'])
					.arrowsFrom('node-32', ['new-2'])
					.arrowsFrom('new-4', ['new-3'])
					.arrowsFrom('node-42', ['node-32'])
					.arrowsFrom(input.source, [input.target])
					.build(),
				direction,
				bias,
			});
		},
		assert(layout) {
			const check = AssertLayout(layout);
			check
				.ports(input.source, { role: 'outgoing' })
				.haveCount(1)
				.areCentered()
				.haveClearance(portPolicy);
			check
				.ports(input.target, { role: 'incoming' })
				.haveCount(2)
				.areCentered()
				.haveClearance(portPolicy);
			check.node(input.source).hasSizeForUsedPorts({ content: 180, ...portPolicy });
			check.node(input.target).hasSizeForUsedPorts({ content: 180, ...portPolicy });
			check
				.routes()
				.areOrthogonal()
				.areAttachedToEndpoints()
				.followLayoutFlow()
				.haveNoCrossing()
				.haveOnlyAllowedSharedTrunks();
			check.obstacles().haveClearance(24);
		},
	};
}

const variants = [
	variant({
		id: 'partial-bipartite-routing-left-to-right',
		label: 'Relation croisée de gauche à droite',
		source: 'new-4',
		target: 'node-32',
	}),
	variant({
		id: 'partial-bipartite-routing-right-to-left',
		label: 'Relation croisée de droite à gauche',
		source: 'node-42',
		target: 'new-3',
	}),
] as const;

export const scenario: LayoutScenario = {
	...variants[0],
	id: 'partial-bipartite-routing',
	label: 'Trois relations ne suggèrent pas la quatrième',
	variants,
};

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { railPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import type { LayoutScenario } from '../scenario';

const backdrop = [
	'alcoa',
	'partner-content',
	'docx',
	'data-team',
	'prompt-management',
	'guarantees',
	'workflow',
	'ai-generation',
	'goal',
] as const;

function withBackdrop(ids: readonly string[], direction: LayoutDirection) {
	return graphFixtures
		.routingNodes([...backdrop, ...ids], direction, 180)
		.arrowsFrom('alcoa', ['guarantees'])
		.arrowsFrom('partner-content', ['guarantees'])
		.arrowsFrom('docx', ['workflow'])
		.arrowsFrom('data-team', ['ai-generation'])
		.arrowsFrom('prompt-management', ['ai-generation'])
		.arrowsFrom('guarantees', ['goal'])
		.arrowsFrom('workflow', ['goal'])
		.arrowsFrom('ai-generation', ['goal']);
}

function chainVariant(input: {
	readonly id: string;
	readonly label: string;
	readonly twoShortcuts: boolean;
}): LayoutScenario {
	return {
		id: input.id,
		label: input.label,
		description:
			'Une chaîne ajoutée à droite du document témoin utilise son corridor extérieur plutôt que l’espace entre les composantes.',
		group: 'Rails et ports',
		order: 240,
		expectedFailure: true,
		arrange(direction = LayoutDirection.TopToBottom, bias) {
			const builder = withBackdrop(['new-1', 'new-2', 'new-3', 'new-4'], direction)
				.arrowsFrom('new-2', ['new-1'])
				.arrowsFrom('new-3', ['new-2'])
				.arrowsFrom('new-4', ['new-3', 'new-1']);
			if (input.twoShortcuts) builder.arrowsFrom('new-3', ['new-1']);
			return layoutNodes({ ...builder.build(), direction, bias });
		},
		assert(layout) {
			const check = AssertLayout(layout);
			const axis = axesFor(layout.direction).transverse;
			const direct = ['new-2-to-new-1', 'new-3-to-new-2', 'new-4-to-new-3'];
			const shortcuts = ['new-4-to-new-1'];
			check
				.envelope(['new-1', 'new-2', 'new-3', 'new-4'])
				.isAfter(layout.envelopeOf(backdrop), { direction: 'transverse-positive' });
			check.route('new-4-to-new-1').usesPositiveSideOf(layout.envelopeOf(['new-2', 'new-3']), {
				axis,
				clearance: railPolicy.inset,
			});
			if (input.twoShortcuts) {
				shortcuts.push('new-3-to-new-1');
				check.route('new-3-to-new-1').usesPositiveSideOf(layout.getById('new-2'), {
					axis,
					clearance: railPolicy.inset,
				});
			}
			check.routes(shortcuts).haveNoCrossingWith(direct);
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

function branchVariant(): LayoutScenario {
	return {
		id: 'branch-shortcut-uses-nearest-outer-side',
		label: 'Le raccourci de branche longe le côté extérieur',
		description:
			'Le raccourci de la branche droite vers la racine reste à droite du nœud intermédiaire.',
		group: 'Rails et ports',
		order: 240,
		expectedFailure: true,
		arrange(direction = LayoutDirection.TopToBottom, bias) {
			return layoutNodes({
				...withBackdrop(['new-1', 'new-2', 'new-3', 'node-32'], direction)
					.arrowsFrom('new-2', ['new-1'])
					.arrowsFrom('new-3', ['new-2'])
					.arrowsFrom('node-32', ['new-2', 'new-1'])
					.build(),
				direction,
				bias,
			});
		},
		assert(layout) {
			const check = AssertLayout(layout);
			check
				.envelope(['new-1', 'new-2', 'new-3', 'node-32'])
				.isAfter(layout.envelopeOf(backdrop), { direction: 'transverse-positive' });
			check.route('node-32-to-new-1').usesPositiveSideOf(layout.getById('new-2'), {
				axis: axesFor(layout.direction).transverse,
				clearance: railPolicy.inset,
			});
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
	chainVariant({
		id: 'shortcut-chain-uses-free-side',
		label: 'Le raccourci reste du côté libre',
		twoShortcuts: false,
	}),
	chainVariant({
		id: 'parallel-shortcuts-stay-on-free-side',
		label: 'Deux raccourcis restent du côté libre',
		twoShortcuts: true,
	}),
	branchVariant(),
] as const;

export const scenario: LayoutScenario = {
	...variants[0],
	id: 'shortcut-routes-use-free-side',
	label: 'Les raccourcis utilisent le côté libre',
	variants,
};

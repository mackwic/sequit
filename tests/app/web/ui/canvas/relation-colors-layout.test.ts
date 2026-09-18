import { expect, it } from 'vitest';

import { renderRelationPaths } from '../../../../../src/app/web/ui/canvas/render-relations';
import { defined } from '../../../../../src/lib/core/document/logic-document';
import { scenario as interClusterPassage } from '../../../../scenarios/visual/routing/inter-cluster-passage.scenario';
import { scenario } from '../../../../scenarios/visual/routing/junction-crossing-obstacle.scenario';
import { routeCrossings, routeSegments } from '../../../../support/assertions/route-geometry';
import { LAYOUT_CONFIGURATIONS } from '../../../../support/builders/layout-bias-scenario';

it.each(LAYOUT_CONFIGURATIONS)(
	'does not contrast routed arrivals sharing a trunk or separated beyond the threshold in $direction / $bias',
	async ({ direction, bias }) => {
		const layout = await scenario.arrange(direction, bias);
		scenario.assert(layout);
		const arrivals = ['u1-to-p2', 'u2-to-p2'].map((id) =>
			defined(layout.relations.find((route) => route.id === id)),
		);
		// These routes approach the same node at separate ports without crossing each other.
		const first = defined(routeSegments(defined(arrivals[0])).at(-1));
		const second = defined(routeSegments(defined(arrivals[1])).at(-1));
		expect(first.axis).toBe(second.axis);
		const separation = Math.abs(first.fixed - second.fixed);
		expect(separation === 0 || separation > 24).toBe(true);
		expect(Math.min(first.end, second.end) - Math.max(first.start, second.start)).toBeGreaterThan(
			0,
		);
		expect(routeCrossings(arrivals)).toHaveLength(0);

		const isolatedColors = new Map(
			renderRelationPaths(arrivals).map(({ id, color }) => [id, color]),
		);
		expect(isolatedColors.get('u1-to-p2')).toBe(isolatedColors.get('u2-to-p2'));

		const colors = new Map(
			renderRelationPaths(layout.relations).map(({ id, color }) => [id, color]),
		);
		const reversed = new Map(
			renderRelationPaths(layout.relations.toReversed()).map(({ id, color }) => [id, color]),
		);
		expect(reversed).toEqual(colors);
	},
);

it.each(LAYOUT_CONFIGURATIONS)(
	'keeps a spaced grouped bypassed chain in the base ink in $direction / $bias',
	async ({ direction, bias }) => {
		const layout = await interClusterPassage.arrange(direction, bias);
		interClusterPassage.assert(layout);
		const colors = new Map(
			renderRelationPaths(layout.relations).map(({ id, color }) => [id, color]),
		);
		for (const id of ['want-to-need', 'solution-to-want', 'solution-to-need'])
			expect(colors.get(id)).toBe('var(--content-relation-1)');
	},
);

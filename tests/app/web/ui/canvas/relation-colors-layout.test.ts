import { expect, it } from 'vitest';

import { renderRelationPaths } from '../../../../../src/app/web/ui/canvas/render-relations';
import { defined } from '../../../../../src/lib/core/document/logic-document';
import { scenario } from '../../../../scenarios/visual/routing/junction-crossing-obstacle.scenario';
import { routeCrossings, routeSegments } from '../../../../support/assertions/route-geometry';
import { LAYOUT_CONFIGURATIONS } from '../../../../support/builders/layout-bias-scenario';

it.each(LAYOUT_CONFIGURATIONS)(
	'distinguishes nearby routed arrivals around junctions in $direction / $bias',
	async ({ direction, bias }) => {
		const layout = await scenario.arrange(direction, bias);
		scenario.assert(layout);
		const arrivals = ['u1-to-p2', 'u2-to-p2'].map((id) =>
			defined(layout.relations.find((route) => route.id === id)),
		);
		// These routes approach the same node at separate quays without crossing each other.
		const first = defined(routeSegments(defined(arrivals[0])).at(-1));
		const second = defined(routeSegments(defined(arrivals[1])).at(-1));
		expect(first.axis).toBe(second.axis);
		expect(Math.abs(first.fixed - second.fixed)).toBe(48);
		expect(Math.min(first.end, second.end) - Math.max(first.start, second.start)).toBeGreaterThan(
			0,
		);
		expect(routeCrossings(arrivals)).toHaveLength(0);

		const colors = new Map(
			renderRelationPaths(layout.relations).map(({ id, color }) => [id, color]),
		);
		expect(colors.get('u1-to-p2')).not.toBe(colors.get('u2-to-p2'));
		expect(new Set(colors.values()).size).toBeGreaterThanOrEqual(3);
		const reversed = new Map(
			renderRelationPaths(layout.relations.toReversed()).map(({ id, color }) => [id, color]),
		);
		expect(reversed).toEqual(colors);
	},
);

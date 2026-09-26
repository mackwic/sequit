import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import { RoutingPortRole } from '../../../src/lib/core/layout/layout-types';
import { routeCrossings } from '../../support/assertions/route-geometry';
import { LAYOUT_CONFIGURATIONS } from '../../support/builders/layout-bias-scenario';
import { axesFor } from '../../support/harnesses/visual-directions';
import { executableScenarios } from './catalogue';
import { scenario as conditionalPorts } from './routing/conditional-incoming-ports.scenario';
describe.each(executableScenarios)('$id shared scenario', (scenario) => {
	it.each(LAYOUT_CONFIGURATIONS)(
		'passes with $direction and $bias bias',
		async ({ direction, bias }) => {
			const layout = await scenario.arrange(direction, bias);
			scenario.assert(layout);
		},
	);
	it.each(Object.values(LayoutDirection))(
		'passes with the real engine in %s',
		async (direction) => {
			const layout = await scenario.arrange(direction);
			expect(layout.direction).toBe(direction);
			scenario.assert(layout);
		},
	);
	it('defaults to top-to-bottom', async () => {
		const layout = await scenario.arrange();
		expect(layout.direction).toBe(LayoutDirection.TopToBottom);
		scenario.assert(layout);
	});
});

describe('conditional incoming-port topology versus target order', () => {
	it.each(Object.values(LayoutDirection))(
		'keeps three target ports for identical relations despite opposite target order in %s',
		async (direction) => {
			const dense = conditionalPorts.variants?.find(
				({ id }) => id === 'conditional-incoming-ports-crossed',
			);
			const reversed = conditionalPorts.variants?.find(
				({ id }) => id === 'conditional-incoming-ports-dense-reordered',
			);
			if (dense === undefined || reversed === undefined)
				throw new Error('Missing dense order contrast');
			const first = await dense.arrange(direction);
			const second = await reversed.arrange(direction);
			dense.assert(first);
			reversed.assert(second);
			expect(second.relations.map(({ id, from, to }) => ({ id, from, to }))).toEqual(
				first.relations.map(({ id, from, to }) => ({ id, from, to })),
			);
			const axis = axesFor(direction).transverse;
			expect(first.getById('d').bounds[axis]).toBeLessThan(first.getById('e').bounds[axis]);
			expect(second.getById('d').bounds[axis]).toBeGreaterThan(second.getById('e').bounds[axis]);
			for (const layout of [first, second]) {
				const incoming = layout.routingInspection?.nodes
					.find(({ id }) => id === 'd')
					?.ports.filter(({ role }) => role === RoutingPortRole.Incoming);
				expect(incoming).toHaveLength(3);
				expect(routeCrossings(layout.relations).length).toBeGreaterThan(0);
			}
		},
	);
});

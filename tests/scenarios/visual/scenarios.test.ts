import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import { RoutingPortRole } from '../../../src/lib/core/layout/layout-types';
import { routeCrossings } from '../../support/assertions/route-geometry';
import { LAYOUT_CONFIGURATIONS } from '../../support/builders/layout-bias-scenario';
import { axesFor } from '../../support/harnesses/visual-directions';
import { executableScenarios } from './catalogue';
import { scenario as conditionalPorts } from './routing/conditional-incoming-ports.scenario';
import {
	crossingNearIncidentJunction,
	scenario as junctionObstacle,
} from './routing/junction-crossing-obstacle.scenario';

describe.each(executableScenarios)('$id shared scenario', (scenario) => {
	let scenarioTest = it;
	if (scenario.expectedFailure === true) scenarioTest = it.fails;
	scenarioTest.each(LAYOUT_CONFIGURATIONS)(
		'passes with $direction and $bias bias',
		async ({ direction, bias }) => {
			const layout = await scenario.arrange(direction, bias);
			scenario.assert(layout);
		},
	);
	scenarioTest.each(Object.values(LayoutDirection))(
		'passes with the real engine in %s',
		async (direction) => {
			const layout = await scenario.arrange(direction);
			expect(layout.direction).toBe(direction);
			scenario.assert(layout);
		},
	);
	scenarioTest('defaults to top-to-bottom', async () => {
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

describe('junction-incident crossing isolation', () => {
	it.each(Object.values(LayoutDirection))(
		'rejects a K4,2 crossing without any j* route despite retained ordinary crossings in %s',
		async (direction) => {
			const layout = await junctionObstacle.arrange(direction);
			const incident = new Set(['j1-to-s', 'j2-to-j1', 'g-to-j2']);
			const ordinary = layout.relations.filter(({ id }) => !incident.has(id));
			expect(routeCrossings(ordinary).length).toBeGreaterThan(0);
			expect(crossingNearIncidentJunction(layout)).toBe(true);
			expect(crossingNearIncidentJunction({ elements: layout.elements, relations: ordinary })).toBe(
				false,
			);
		},
	);
});

import { describe, expect, it } from 'vitest';

import { catalogue } from '../../../../src/app/workshop/visual-tests/catalogue';
import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';

describe.each(catalogue.map(({ scenario }) => scenario))('$id shared scenario', (scenario) => {
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

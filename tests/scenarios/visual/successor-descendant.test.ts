import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import { axesFor } from '../../support/harnesses/visual-directions';
import { scenario } from './nodes/two-successors-with-descendant.scenario';

describe.each(Object.values(LayoutDirection))(
	'successor and descendant centers in %s',
	(direction) => {
		it.each([
			{ ids: ['b', 'c', 'd'], envelope: 'envelope(b,c)' },
			{ ids: ['d'], envelope: 'envelope(d)' },
		])('detects drift of $envelope independently', async ({ ids, envelope }) => {
			const computed = await scenario.arrange(direction);
			const axis = axesFor(direction).transverse;
			// Build a passing assertion fixture without changing the actual engine scenario:
			// retain its geometry except for D, aligned explicitly with its equal-sized parent B.
			const layout = computed.withElements(
				computed.elements.map((box) => {
					if (box.id !== 'd') return box;
					return { ...box, bounds: { ...box.bounds, [axis]: computed.getById('b').bounds[axis] } };
				}),
			);
			const displaced = layout.withElements(
				layout.elements.map((box) => {
					if (!ids.includes(box.id)) return box;
					return { ...box, bounds: { ...box.bounds, [axis]: box.bounds[axis] + 10 } };
				}),
			);
			expect(() => {
				scenario.assert(displaced);
			}).toThrow(`Box "${envelope}"`);
			scenario.assert(layout);
		});
	},
);

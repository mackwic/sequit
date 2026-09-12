import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import { axesFor } from '../../support/harnesses/visual-directions';
import { scenario as threeSuccessors } from './nodes/three-successors.scenario';
import { scenario as withIsolatedNode } from './nodes/three-successors-and-isolated-node.scenario';
import { scenario as twoSuccessors } from './nodes/two-successors.scenario';

describe.each([twoSuccessors, threeSuccessors, withIsolatedNode])(
	'$id regression detection',
	(scenario) => {
		it.each(Object.values(LayoutDirection))(
			'detects a displaced successor envelope in %s',
			async (direction) => {
				const layout = await scenario.arrange(direction);
				const axis = axesFor(direction).transverse;
				const displaced = layout.withElements(
					layout.elements.map((box) => {
						if (!['b', 'c', 'd'].includes(box.id)) return box;
						return { ...box, bounds: { ...box.bounds, [axis]: box.bounds[axis] + 10 } };
					}),
				);
				expect(() => {
					scenario.assert(displaced);
				}).toThrow('difference=10');
				scenario.assert(layout);
			},
		);
	},
);

describe.each(Object.values(LayoutDirection))('isolated node separation in %s', (direction) => {
	it.each([0, -10])('rejects touching or overlapping bounds (gap=%s)', async (gap) => {
		const layout = await withIsolatedNode.arrange(direction);
		const envelope = layout.envelopeOf(['b', 'c', 'd']).bounds;
		const axis = axesFor(direction).transverse;
		let edge = envelope.x + envelope.width;
		if (axis === 'y') edge = envelope.y + envelope.height;
		const overlapping = layout.withElements(
			layout.elements.map((box) => {
				if (box.id !== 'e') return box;
				return { ...box, bounds: { ...box.bounds, [axis]: edge + gap } };
			}),
		);
		expect(() => {
			withIsolatedNode.assert(overlapping);
		}).toThrow('Box "e" must be after "envelope(b,c,d)"');
	});
});

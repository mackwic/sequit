import { describe, expect, it } from 'vitest';

import { scenario } from '../../../../src/app/workshop/visual-tests/cases/nodes/successors-and-independent-chain.scenario';
import { axesFor } from '../../../../src/app/workshop/visual-tests/directions';
import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';

describe.each(Object.values(LayoutDirection))('independent chain in %s', (direction) => {
	it('detects F drifting away from the transverse center of E', async () => {
		const layout = await scenario.arrange(direction);
		const axis = axesFor(direction).transverse;
		const displaced = layout.withElements(
			layout.elements.map((box) => {
				if (box.id !== 'f') return box;
				return { ...box, bounds: { ...box.bounds, [axis]: box.bounds[axis] + 10 } };
			}),
		);
		expect(() => {
			scenario.assert(displaced);
		}).toThrow('difference=10');
	});
	it.each([0, -10])('rejects touching or overlapping component envelopes (gap=%s)', async (gap) => {
		const layout = await scenario.arrange(direction);
		const left = layout.envelopeOf(['a', 'b', 'c', 'd']).bounds;
		const right = layout.envelopeOf(['e', 'f']).bounds;
		const axis = axesFor(direction).transverse;
		let edge = left.x + left.width;
		if (axis === 'y') edge = left.y + left.height;
		const delta = edge + gap - right[axis];
		const displaced = layout.withElements(
			layout.elements.map((box) => {
				if (!['e', 'f'].includes(box.id)) return box;
				return { ...box, bounds: { ...box.bounds, [axis]: box.bounds[axis] + delta } };
			}),
		);
		expect(() => {
			scenario.assert(displaced);
		}).toThrow('"envelope(e,f)" must be after "envelope(a,b,c,d)"');
	});
});

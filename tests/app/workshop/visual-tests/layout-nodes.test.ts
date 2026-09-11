import fc from 'fast-check';
import { expect, it } from 'vitest';

import { AssertBox } from '../../../../src/app/workshop/visual-tests/assert-box';
import { layoutNodes } from '../../../../src/app/workshop/visual-tests/layout-nodes';
import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

it('applies the selected bias to the actual engine, independently from direction', async () => {
	const fixture = {
		direction: LayoutDirection.TopToBottom,
		nodes: { a: { width: 100, height: 60 }, b: { width: 200, height: 120 } },
		relations: [],
	};
	const top = await layoutNodes({ ...fixture, bias: LayoutBias.Top });
	const bottom = await layoutNodes({ ...fixture, bias: LayoutBias.Bottom });
	expect(top.getById('a').bounds.y).toBe(40);
	expect(top.getById('b').bounds.y).toBe(40);
	expect(bottom.getById('a').bounds.y).toBe(100);
	expect(bottom.getById('b').bounds.y).toBe(40);
	await expect(layoutNodes({ ...fixture, bias: LayoutBias.Left })).rejects.toThrow(
		'Incompatible layout direction and bias',
	);
});

it('rejects a cyclic node fixture instead of running a misleading assertion', async () => {
	await expect(
		layoutNodes({
			direction: LayoutDirection.TopToBottom,
			nodes: { a: { width: 100, height: 60 }, b: { width: 100, height: 60 } },
			relations: [
				{ id: 'a-b', from: 'a', to: 'b' },
				{ id: 'b-a', from: 'b', to: 'a' },
			],
		}),
	).rejects.toThrow('must form an acyclic graph');
});

it('centers a single node for varied dimensions in every direction without doubling the outer margin', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.record({
				width: fc.integer({ min: 1, max: 600 }),
				height: fc.integer({ min: 1, max: 300 }),
			}),
			async (size) => {
				for (const direction of Object.values(LayoutDirection)) {
					const layout = await layoutNodes({ direction, nodes: { a: size }, relations: [] });
					const a = layout.getNodeById('a');
					AssertBox(a).isCenteredIn(layout.frame, { axis: 'both' });
					// Pin the engine's existing 40-unit margin on all sides, independently of the matcher.
					expect(a.bounds).toEqual({ x: 40, y: 40, ...size });
					expect(layout.width).toBe(size.width + 80);
					expect(layout.height).toBe(size.height + 80);
				}
			},
		),
		PROPERTY_PARAMETERS,
	);
});

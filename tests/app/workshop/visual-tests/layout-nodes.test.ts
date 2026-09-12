import fc from 'fast-check';
import { expect, it } from 'vitest';

import { AssertBox } from '../../../../src/app/workshop/visual-tests/asserts/assert-box';
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

it.each(Object.values(LayoutDirection))(
	'keeps roots first and points child-to-parent arrows against %s, including a short branch',
	async (direction) => {
		const size = { width: 100, height: 60 };
		const relations = [
			{ id: 'b-a', from: 'b', to: 'a' },
			{ id: 'c-b', from: 'c', to: 'b' },
			{ id: 'c-a', from: 'c', to: 'a' },
			{ id: 'd-a', from: 'd', to: 'a' },
		];
		const layout = await layoutNodes({
			direction,
			nodes: { a: size, b: size, c: size, d: size, isolated: size },
			relations,
		});
		expect(['a', 'b', 'c', 'd', 'isolated'].map((id) => layout.getNodeById(id).rank)).toEqual([
			1, 2, 3, 2, 1,
		]);
		for (const relation of layout.relations) {
			expect(relations).toContainEqual({ id: relation.id, from: relation.from, to: relation.to });
			const child = layout.getNodeById(relation.from);
			const parent = layout.getNodeById(relation.to);
			AssertBox(child).isAfter(parent, { direction });
			const start = relation.points.at(0);
			const tip = relation.points.at(-1);
			if (direction === LayoutDirection.TopToBottom) {
				expect(start?.y).toBe(child.bounds.y);
				expect(tip?.y).toBe(parent.bounds.y + parent.bounds.height);
			} else if (direction === LayoutDirection.BottomToTop) {
				expect(start?.y).toBe(child.bounds.y + child.bounds.height);
				expect(tip?.y).toBe(parent.bounds.y);
			} else if (direction === LayoutDirection.LeftToRight) {
				expect(start?.x).toBe(child.bounds.x);
				expect(tip?.x).toBe(parent.bounds.x + parent.bounds.width);
			} else {
				expect(start?.x).toBe(child.bounds.x + child.bounds.width);
				expect(tip?.x).toBe(parent.bounds.x);
			}
		}
	},
);

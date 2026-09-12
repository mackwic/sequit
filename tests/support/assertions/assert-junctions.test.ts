import { describe, expect, it } from 'vitest';

import { EndpointKind, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { LayoutElement, LayoutRelation } from '../../../src/lib/core/layout/layout-types';
import { graphFixtures } from '../fixtures/graph-fixtures';
import { layoutNodes } from '../harnesses/layout-nodes';
import { VisualLayout } from '../harnesses/visual-layout';
import { AssertLayout } from './assert-layout';

function node(id: string, y: number): LayoutElement {
	return { id, kind: EndpointKind.Node, bounds: { x: 0, y, width: 48, height: 48 } };
}
function junction(id: string, y: number, x = 0): LayoutElement {
	return { ...node(id, y), kind: EndpointKind.Junction, bounds: { x, y, width: 48, height: 48 } };
}
function layout(
	junctions: readonly LayoutElement[],
	relations: readonly LayoutRelation[] = [],
): VisualLayout {
	return new VisualLayout(
		{ width: 400, height: 240, elements: [node('a', 0), ...junctions, node('b', 192)], relations },
		new Map([
			['a', 0],
			['b', 1],
		]),
	);
}

describe('junction observations reject plausible incorrect layouts', () => {
	it('checks the rectangle centre, not its edge, on the base rail', () => {
		AssertLayout(layout([junction('j', 96)]))
			.junctions(['j'])
			.areOnBaseRail(['a'], ['b']);
		expect(() =>
			AssertLayout(layout([junction('j', 120)]))
				.junctions(['j'])
				.areOnBaseRail(['a'], ['b']),
		).toThrow('rail de base');
	});
	it('checks both interval boundaries and clearance', () => {
		AssertLayout(layout([junction('j', 96)]))
			.junctions(['j'])
			.areBetween(['a'], ['b'], 12);
		for (const y of [40, 50, 134, 200])
			expect(() =>
				AssertLayout(layout([junction('j', y)]))
					.junctions(['j'])
					.areBetween(['a'], ['b'], 12),
			).toThrow();
	});
	it('rejects reversed, shared and overlapping rails in a chain', () => {
		AssertLayout(layout([junction('j1', 60), junction('j2', 120)]))
			.junctions(['j1', 'j2'])
			.areOnSeparateProgressiveRails(12);
		for (const y of [0, 60, 100])
			expect(() =>
				AssertLayout(layout([junction('j1', 60), junction('j2', y)]))
					.junctions(['j1', 'j2'])
					.areOnSeparateProgressiveRails(12),
			).toThrow();
	});
	it('requires shared rails to align centres of distinct junctions', () => {
		AssertLayout(layout([junction('j1', 96), junction('j2', 96, 100)]))
			.junctions(['j1', 'j2'])
			.areOnSameRail();
		expect(() =>
			AssertLayout(layout([junction('j1', 96), junction('j2', 97, 100)]))
				.junctions(['j1', 'j2'])
				.areOnSameRail(),
		).toThrow();
	});
	it('requires a real transverse route on the junction rail', () => {
		const route = {
			id: 'r',
			from: 'a',
			to: 'b',
			points: [
				{ x: 100, y: 120 },
				{ x: 160, y: 120 },
			],
		};
		AssertLayout(layout([junction('j', 96)], [route]))
			.junctions(['j'])
			.areOnRailOfRoute('r');
		expect(() =>
			AssertLayout(layout([junction('j', 90)], [route]))
				.junctions(['j'])
				.areOnRailOfRoute('r'),
		).toThrow();
	});
	it('rejects foreign routes through a junction, including boundary contact', () => {
		for (const x of [0, 24, 48, 55]) {
			const route = {
				id: 'r',
				from: 'a',
				to: 'b',
				points: [
					{ x, y: 48 },
					{ x, y: 192 },
				],
			};
			expect(() => {
				AssertLayout(layout([junction('j', 96)], [route]))
					.obstacles()
					.haveClearance(12);
			}).toThrow('obstacle');
		}
		AssertLayout(
			layout(
				[junction('j', 96)],
				[
					{
						id: 'r',
						from: 'a',
						to: 'b',
						points: [
							{ x: 60, y: 48 },
							{ x: 60, y: 192 },
						],
					},
				],
			),
		)
			.obstacles()
			.haveClearance(12);
	});
	it('rejects overlapping junctions and invalid selections', () => {
		expect(() => {
			AssertLayout(layout([junction('j1', 96), junction('j2', 96, 40)]))
				.obstacles()
				.haveClearance(12);
		}).toThrow('objets');
		for (const ids of [[], ['j', 'j'], ['a']])
			expect(() => AssertLayout(layout([junction('j', 96)])).junctions(ids)).toThrow();
	});
	it('checks actual junction quay counts when deriving the minimum size', () => {
		const routes = [0, 48].map((x, i) => ({
			id: `r${i}`,
			from: 'b',
			to: 'j',
			points: [
				{ x, y: 192 },
				{ x, y: 144 },
			],
		}));
		expect(() =>
			AssertLayout(layout([junction('j', 96)], routes))
				.junctions(['j'])
				.haveSizeForUsedQuays({ content: 48, spacing: 48, inset: 24 }),
		).toThrow('Dimension');
	});
});

it('observes real edited document identities as well as rendered identities', async () => {
	const result = await layoutNodes({
		...graphFixtures.directedChain().build(),
		direction: LayoutDirection.TopToBottom,
		edit: { removeRelations: ['a-to-b'] },
	});
	AssertLayout(result).document().hasEndpoints(['a', 'b']).hasRelations([]);
	expect(() => AssertLayout(result).document().hasEndpoints(['a'])).toThrow('document');
	expect(() => AssertLayout(result).document().hasRelations(['a-to-b'])).toThrow('document');
	expect(() => AssertLayout(result.withElements([])).document().hasEndpoints(['a', 'b'])).toThrow(
		'layout',
	);
});

it.each(Object.values(LayoutDirection))('finds the preceding physical row in %s', (direction) => {
	const elements = [node('a', 0), node('c', 192), junction('j', 288), node('b', 384)].map(
		(element) => {
			let { x, y, width, height } = element.bounds;
			if ([LayoutDirection.BottomToTop, LayoutDirection.RightToLeft].includes(direction))
				y = 480 - y - height;
			if ([LayoutDirection.LeftToRight, LayoutDirection.RightToLeft].includes(direction))
				[x, y, width, height] = [y, x, height, width];
			return { ...element, bounds: { x, y, width, height } };
		},
	);
	const result = new VisualLayout(
		{ width: 480, height: 480, elements, relations: [] },
		new Map(),
		direction,
	);
	AssertLayout(result).junctions(['j']).areImmediatelyBefore('b', ['a', 'c'], 12);
	// Replacing the junction with the root's rectangle puts it before the wrong physical row.
	const misplaced = result.withElements(
		elements.map((element) => {
			if (element.id === 'j') return { ...element, bounds: result.getById('a').bounds };
			return element;
		}),
	);
	expect(() =>
		AssertLayout(misplaced).junctions(['j']).areImmediatelyBefore('b', ['a', 'c'], 12),
	).toThrow();
});

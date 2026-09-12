import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import { axesFor } from '../../support/harnesses/visual-directions';
import { VisualLayout } from '../../support/harnesses/visual-layout';
import { scenario as centeredChain } from './nodes/centered-chain.scenario';
import { scenario as directedChain } from './nodes/directed-chain.scenario';
import { scenario as independentNodes } from './nodes/independent-nodes.scenario';
import { scenario as singleNode } from './nodes/single-node.scenario';

describe('single node regression detection', () => {
	it.each(['x', 'y'] as const)('fails when the node is displaced on %s', async (axis) => {
		const layout = await singleNode.arrange();
		const displaced = layout.withElements(
			layout.elements.map((box) => ({
				...box,
				bounds: { ...box.bounds, [axis]: box.bounds[axis] + 10 },
			})),
		);
		expect(() => {
			singleNode.assert(displaced);
		}).toThrow('difference=10');
		singleNode.assert(layout);
	});
});

describe.each([
	{ direction: LayoutDirection.TopToBottom, main: 'y', transverse: 'x' },
	{ direction: LayoutDirection.BottomToTop, main: 'y', transverse: 'x' },
	{ direction: LayoutDirection.LeftToRight, main: 'x', transverse: 'y' },
	{ direction: LayoutDirection.RightToLeft, main: 'x', transverse: 'y' },
] as const)('regression detection in $direction', ({ direction, main, transverse }) => {
	it('detects centers no longer sharing a row', async () => {
		const layout = await independentNodes.arrange(direction);
		const displaced = layout.withElements(
			layout.elements.map((box) => {
				if (box.id !== 'b') return box;
				return { ...box, bounds: { ...box.bounds, [main]: box.bounds[main] + 10 } };
			}),
		);
		expect(() => {
			independentNodes.assert(displaced);
		}).toThrow('difference=10');
	});
	it('detects an off-center envelope even when the centers still share a row', async () => {
		const layout = await independentNodes.arrange(direction);
		const displaced = layout.withElements(
			layout.elements.map((box) => ({
				...box,
				bounds: { ...box.bounds, [transverse]: box.bounds[transverse] + 10 },
			})),
		);
		expect(() => {
			independentNodes.assert(displaced);
		}).toThrow('Box "envelope(a,b)"');
	});
	it('detects swapped positions even when the logical ranks stay correct', async () => {
		const layout = await directedChain.arrange(direction);
		const a = layout.getById('a');
		const b = layout.getById('b');
		const swapped = layout.withElements([
			{ ...a, bounds: b.bounds },
			{ ...b, bounds: a.bounds },
		]);
		expect(() => {
			directedChain.assert(swapped);
		}).toThrow(`must be after "a" in ${direction}`);
	});
	it('detects transverse drift and preserves the original', async () => {
		const layout = await centeredChain.arrange(direction);
		const displaced = layout.withElements(
			layout.elements.map((element) => {
				if (element.id !== 'b') return element;
				const axis = axesFor(direction).transverse;
				return { ...element, bounds: { ...element.bounds, [axis]: element.bounds[axis] + 10 } };
			}),
		);
		expect(() => {
			centeredChain.assert(displaced);
		}).toThrow('difference=10');
		centeredChain.assert(layout);
	});
});

it('detects a wrong logical rank even when positions stay correct', async () => {
	const layout = await directedChain.arrange();
	const wrongRanks = new VisualLayout(
		layout,
		new Map([
			['a', 0],
			['b', 0],
		]),
		layout.direction,
	);
	expect(() => {
		directedChain.assert(wrongRanks);
	}).toThrow('expected rank=2, actual=1');
});

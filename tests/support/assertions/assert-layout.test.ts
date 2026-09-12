import fc from 'fast-check';
import { expect, it } from 'vitest';

import { EndpointKind, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';
import { LAYOUT_CONFIGURATIONS } from '../builders/layout-bias-scenario';
import { PROPERTY_PARAMETERS } from '../builders/property-test-options';
import { graphFixtures } from '../fixtures/graph-fixtures';
import { layoutNodes } from '../harnesses/layout-nodes';
import { axesFor } from '../harnesses/visual-directions';
import { VisualLayout } from '../harnesses/visual-layout';
import { AssertLayout } from './assert-layout';
import { VisualAssertionError } from './assertion-error';

function diagnostic(assert: () => void): VisualAssertionError {
	try {
		assert();
	} catch (error) {
		if (error instanceof VisualAssertionError) return error;
		throw error;
	}
	throw new Error('Expected a structured assertion failure.');
}

it.each(LAYOUT_CONFIGURATIONS)(
	'checks each node and their collective envelope in $direction/$bias',
	async (configuration) => {
		const layout = await layoutNodes({
			...configuration,
			...graphFixtures.twoSuccessors().build(),
		});
		const check = AssertLayout(layout);
		const a = check.node('a');
		expect(a.hasRank(1)).toBe(a);
		const successors = check.nodes(['b', 'c']);
		expect(successors.haveRank(2).areAfter('a')).toBe(successors);
		const envelope = check.envelope(['b', 'c']);
		expect(envelope.isCenteredOn('a', { axis: 'transverse' }).isAfter('a')).toBe(envelope);
		// Collective centering must not be confused with centering each individual successor.
		const failure = diagnostic(() => check.node('b').isCenteredOn('a', { axis: 'transverse' }));
		expect(failure.code).toBe('box.centering');
		expect(failure.targets).toEqual({ boxes: ['b'], referenceBoxes: ['a'] });
		expect(failure.context?.axis).toBe(axesFor(configuration.direction).transverse);
	},
);

it.each(Object.values(LayoutDirection))(
	'keeps positive transverse separation independent of progression in %s',
	async (direction) => {
		const layout = await layoutNodes({
			direction,
			...graphFixtures.threeSuccessors().withIsolatedNode('e').build(),
		});
		const envelope = layout.envelopeOf(['b', 'c', 'd']);
		const e = AssertLayout(layout).node('e');
		expect(e.hasRank(1).isAfter(envelope, { direction: 'transverse-positive' })).toBe(e);
		const axis = axesFor(direction).transverse;
		for (const gap of [0, -10]) {
			let edge = envelope.bounds.x + envelope.bounds.width;
			if (axis === 'y') edge = envelope.bounds.y + envelope.bounds.height;
			const changed = layout.withElements(
				layout.elements.map((node) => {
					if (node.id !== 'e') return node;
					return { ...node, bounds: { ...node.bounds, [axis]: edge + gap } };
				}),
			);
			const failure = diagnostic(() =>
				AssertLayout(changed).node('e').isAfter(envelope, { direction: 'transverse-positive' }),
			);
			expect(failure.code).toBe('box.order');
			expect(failure.actual).toBe(gap);
			expect(failure.context?.reference).toEqual({ kind: 'envelope', ids: ['b', 'c', 'd'] });
			expect(failure.targets).toEqual({ boxes: ['e'], referenceBoxes: ['b', 'c', 'd'] });
		}
	},
);

it('reports the first wrong member in selection order without interpreting ranks as alignment', async () => {
	const layout = await layoutNodes({
		direction: LayoutDirection.TopToBottom,
		...graphFixtures.twoSuccessors().build(),
	});
	const check = AssertLayout(layout);
	const failure = diagnostic(() => check.nodes(['c', 'b']).haveRank(1));
	expect(failure.code).toBe('node.rank');
	expect(failure.targets.boxes).toEqual(['c']);
	expect(failure.expected).toBe(1);
	expect(failure.actual).toBe(2);
	const shifted = layout.withElements(
		layout.elements.map((node) => ({ ...node, bounds: { ...node.bounds, y: -500 } })),
	);
	AssertLayout(shifted).nodes(['b', 'c']).haveRank(2);
	expect(diagnostic(() => AssertLayout(shifted).nodes(['b', 'c']).areAfter('a')).code).toBe(
		'box.order',
	);
});

it('centers and orders against observed references while retaining the same node subject', async () => {
	const layout = await layoutNodes({
		direction: LayoutDirection.TopToBottom,
		...graphFixtures.directedChain().build(),
	});
	const b = AssertLayout(layout).node('b');
	expect(b.isCenteredOn(layout.getById('a'), { axis: 'x' }).isAfter('a').hasRank(2)).toBe(b);
	expect(b.isAfter('a', { direction: LayoutDirection.TopToBottom })).toBe(b);
	const single = await layoutNodes({
		direction: LayoutDirection.TopToBottom,
		...graphFixtures.independentNodes(['a']).build(),
	});
	AssertLayout(single).envelope(['a']).isCenteredOn(single.frame, { axis: 'both' });
});

it('rejects empty, duplicate, missing and non-node selections before a vacuous check', async () => {
	const layout = await layoutNodes({
		direction: LayoutDirection.TopToBottom,
		...graphFixtures.twoSuccessors().build(),
	});
	const check = AssertLayout(layout);
	expect(() => check.nodes([])).toThrow('at least one');
	expect(() => check.nodes(['b', 'b'])).toThrow('unique');
	expect(() => check.node('missing')).toThrow('Missing layout element');
	expect(() => check.nodes(['b', 'missing'])).toThrow('Missing layout element');
	expect(() => check.envelope([])).toThrow('empty envelope');
	expect(() => check.envelope(['b', 'b'])).toThrow('unique');
	expect(() => check.envelope(['missing'])).toThrow('Missing layout element');
	expect(() => check.node('b').isAfter('missing')).toThrow('Missing layout element');
	const group = layout.withElements([
		{ id: 'g', kind: EndpointKind.Group, bounds: { x: 0, y: 0, width: 100, height: 60 } },
	]);
	expect(() => AssertLayout(group).node('g')).toThrow('Expected a node');
	for (const rank of [0, -1, 1.5, NaN, Infinity])
		expect(() => check.nodes(['b']).haveRank(rank)).toThrow('positive integer');
});

it('preserves envelope membership and numerical evidence under translations and axis exchange', () => {
	fc.assert(
		fc.property(
			fc.integer({ min: -10000, max: 10000 }),
			fc.integer({ min: -10000, max: 10000 }),
			fc.boolean(),
			(x, y, exchange) => {
				const boxes = [
					{ id: 'a', bounds: { x: x + 100, y, width: 100, height: 60 } },
					{ id: 'b', bounds: { x, y: y + 100, width: 100, height: 60 } },
					{ id: 'c', bounds: { x: x + 200, y: y + 100, width: 100, height: 60 } },
				];
				let direction = LayoutDirection.TopToBottom;
				if (exchange) direction = LayoutDirection.LeftToRight;
				const elements = boxes.map((box) => {
					let bounds = box.bounds;
					if (exchange)
						bounds = { x: bounds.y, y: bounds.x, width: bounds.height, height: bounds.width };
					return { ...box, kind: EndpointKind.Node, bounds };
				});
				const layout = new VisualLayout(
					{ width: 500, height: 500, elements, relations: [] },
					new Map([
						['a', 0],
						['b', 1],
						['c', 1],
					]),
					direction,
				);
				AssertLayout(layout).envelope(['b', 'c']).isCenteredOn('a', { axis: 'transverse' });
				const axis = axesFor(direction).transverse;
				const shifted = layout.withElements(
					layout.elements.map((box) => {
						if (box.id === 'a') return box;
						return { ...box, bounds: { ...box.bounds, [axis]: box.bounds[axis] + 10 } };
					}),
				);
				const failure = diagnostic(() =>
					AssertLayout(shifted).envelope(['b', 'c']).isCenteredOn('a', { axis: 'transverse' }),
				);
				expect(failure.code).toBe('box.centering');
				expect(failure.context).toMatchObject({
					subject: { kind: 'envelope', ids: ['b', 'c'] },
					reference: { ids: ['a'] },
					axis,
					difference: 10,
					tolerance: 0.001,
				});
				expect(failure.targets).toEqual({ boxes: ['b', 'c'], referenceBoxes: ['a'] });
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('selects routes strictly by IDs or explicit observations and supports one-to-one comparisons', () => {
	const routes: LayoutRelation[] = [
		{
			id: 'h',
			from: 'a',
			to: 'b',
			points: [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			],
		},
		{
			id: 'v',
			from: 'c',
			to: 'd',
			points: [
				{ x: 50, y: 0 },
				{ x: 50, y: 100 },
			],
		},
		{
			id: 'outside',
			from: 'e',
			to: 'f',
			points: [
				{ x: 200, y: 0 },
				{ x: 200, y: 100 },
			],
		},
	];
	const layout = new VisualLayout({ width: 300, height: 200, elements: [], relations: routes });
	const check = AssertLayout(layout);
	const crossing = check.routes(['h', 'v']);
	expect(crossing.haveCrossing().haveNoOverlap()).toBe(crossing);
	const outside = routes.slice(2);
	expect(check.routes(['h']).haveNoCrossingWith(outside).haveNoOverlapWith(outside)).toBeDefined();
	const failure = diagnostic(() => check.routes().haveNoCrossing());
	expect(failure.code).toBe('routes.crossing');
	expect(failure.targets.routes).toEqual(['h', 'v']);
	expect(failure.actual).toBe(1);
	check.routes(routes).haveNoOverlap();
	expect(() => check.routes(['missing'])).toThrow('Missing layout route');
	expect(() => check.routes([])).toThrow('at least 1');
	expect(() => check.routes(['h', 'h'])).toThrow('unique');
	expect(() => check.routes(['h']).haveCrossing()).toThrow('at least 2');
	expect(() => check.routes(['h']).haveNoOverlap()).toThrow('at least 2');
});

it.each(Object.values(LayoutDirection))(
	'aligns rows and chains through the facade in %s',
	async (direction) => {
		const layout = await layoutNodes({
			...graphFixtures.independentNodes(['a', 'b']).build(),
			direction,
		});
		const check = AssertLayout(layout);
		const a = check.node('a');
		expect(a.isAlignedWith('b', { by: 'row' })).toBe(a);
		const envelope = check.envelope(['a']);
		expect(envelope.isAlignedWith('a', { by: 'top', tolerance: 0 })).toBe(envelope);
		const chain = await layoutNodes({ ...graphFixtures.directedChain().build(), direction });
		AssertLayout(chain).node('a').isAlignedWith('b', { by: 'chain' });
		const axis = axesFor(direction).primary;
		const shifted = layout.withElements(
			layout.elements.map((element) => {
				if (element.id !== 'b') return element;
				return { ...element, bounds: { ...element.bounds, [axis]: element.bounds[axis] + 10 } };
			}),
		);
		const failure = diagnostic(() =>
			AssertLayout(shifted).node('a').isAlignedWith('b', { by: 'row' }),
		);
		expect(failure.code).toBe('box.alignment');
		expect(failure.context?.difference).toBe(10);
		expect(failure.targets).toEqual({ boxes: ['a'], referenceBoxes: ['b'] });
	},
);

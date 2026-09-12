import { describe, expect, it } from 'vitest';

import { EndpointKind, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { LayoutResult } from '../../../src/lib/core/layout/layout-types';
import { VisualLayout } from './visual-layout';

const result: LayoutResult = {
	width: 400,
	height: 300,
	elements: [
		{ id: 'b', kind: EndpointKind.Node, bounds: { x: 0, y: 80, width: 100, height: 60 } },
		{ id: 'a', kind: EndpointKind.Node, bounds: { x: 0, y: 0, width: 100, height: 60 } },
	],
	relations: [{ id: 'a-to-b', from: 'a', to: 'b', points: [] }],
};

describe('VisualLayout.getById', () => {
	it('returns the original element by ID without changing geometry or routing', () => {
		const layout = new VisualLayout(result);
		expect(layout.getById('a')).toBe(result.elements[1]);
		expect(layout.getById('b')).toBe(result.elements[0]);
		expect(layout).toMatchObject(result);
		expect(layout.relations).toBe(result.relations);
	});
	it.each(['missing', 'a-to-b'])('fails explicitly when visual element %s does not exist', (id) => {
		const layout = new VisualLayout(result);
		expect(() => layout.getById(id)).toThrow(`Missing layout element: *[id="${id}"]`);
	});
});

describe('VisualLayout observations', () => {
	it('exposes logical ranks as ordinals starting at 1, independently of element order', () => {
		const ranks = new Map([
			['a', 0],
			['b', 1],
		]);
		const layout = new VisualLayout(result, ranks, LayoutDirection.BottomToTop);
		expect(layout.getNodeById('a').rank).toBe(1);
		expect(layout.getNodeById('b').rank).toBe(2);
		expect(layout.getNodeById('a').bounds).toBe(layout.getById('a').bounds);
		expect(ranks.get('a')).toBe(0);
	});
	it('refuses to invent a logical rank for an element', () => {
		expect(() => new VisualLayout(result).getNodeById('a')).toThrow('Missing logical rank: a');
		const group = {
			...result,
			elements: [
				{ id: 'g', kind: EndpointKind.Group, bounds: { x: 0, y: 0, width: 100, height: 100 } },
			],
		};
		expect(() => new VisualLayout(group).getNodeById('g')).toThrow('Expected a node: g');
	});
	it('keeps ranks, direction and frame during a local geometry simulation', () => {
		const layout = new VisualLayout(
			result,
			new Map([
				['a', 0],
				['b', 1],
			]),
			LayoutDirection.RightToLeft,
		);
		const simulated = layout.withElements([layout.getById('b')]);
		expect(simulated.direction).toBe(LayoutDirection.RightToLeft);
		expect(simulated.getNodeById('b').rank).toBe(2);
		expect(simulated.frame).toEqual({
			id: 'layout',
			identity: { kind: 'frame', ids: [] },
			bounds: { x: 0, y: 0, width: 400, height: 300 },
		});
		expect(simulated.relations).toBe(layout.relations);
		expect(simulated.elements).toHaveLength(1);
		expect(layout.elements).toHaveLength(2);
	});
	it('measures the envelope of only the requested elements, including unequal sizes', () => {
		const layout = new VisualLayout({
			...result,
			elements: [
				{ id: 'a', kind: EndpointKind.Node, bounds: { x: -20, y: 10, width: 100, height: 60 } },
				{ id: 'b', kind: EndpointKind.Node, bounds: { x: 120, y: -10, width: 200, height: 40 } },
				{
					id: 'ignored',
					kind: EndpointKind.Node,
					bounds: { x: 900, y: 900, width: 10, height: 10 },
				},
			],
		});
		expect(layout.envelopeOf(['b', 'a']).bounds).toEqual({
			x: -20,
			y: -10,
			width: 340,
			height: 80,
		});
		expect(layout.envelopeOf(['a']).bounds).toEqual(layout.getById('a').bounds);
		expect(() => layout.envelopeOf([])).toThrow('Cannot measure an empty envelope.');
		expect(() => layout.envelopeOf(['missing'])).toThrow('Missing layout element');
	});
});

it('keeps envelope membership independent of the input selection and rejects invalid observed geometry', () => {
	const layout = new VisualLayout(result);
	const ids = ['b', 'a'];
	const envelope = layout.envelopeOf(ids);
	ids.pop();
	expect(envelope.identity).toEqual({ kind: 'envelope', ids: ['b', 'a'] });
	expect(() => layout.envelopeOf(['a', 'a'])).toThrow('unique');
	for (const width of [NaN, Infinity, 0, -1]) {
		const invalid = layout.withElements([
			{ id: 'invalid', kind: EndpointKind.Node, bounds: { x: 0, y: 0, width, height: 10 } },
		]);
		expect(() => invalid.envelopeOf(['invalid'])).toThrow(
			'finite coordinates and positive dimensions',
		);
	}
});

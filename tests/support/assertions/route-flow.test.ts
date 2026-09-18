import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutDirection,
} from '../../../src/lib/core/document/logic-document';
import type { Bounds, Point } from '../../../src/lib/core/layout/layout-types';
import { VisualLayout } from '../harnesses/visual-layout';
import { AssertLayout } from './assert-layout';
import { AssertPorts, usedPortCount } from './assert-ports';

function fixture(direction: LayoutDirection, points: readonly Point[]): VisualLayout {
	const horizontal = [LayoutDirection.LeftToRight, LayoutDirection.RightToLeft].includes(direction);
	const reverse = [LayoutDirection.BottomToTop, LayoutDirection.RightToLeft].includes(direction);
	const point = ({ x, y }: Point): Point => {
		let primary = y;
		if (reverse) primary = 120 - y;
		if (horizontal) return { x: primary, y: x };
		return { x, y: primary };
	};
	const box = (bounds: Bounds): Bounds => {
		const first = point(bounds);
		const last = point({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
		return {
			x: Math.min(first.x, last.x),
			y: Math.min(first.y, last.y),
			width: Math.abs(last.x - first.x),
			height: Math.abs(last.y - first.y),
		};
	};
	return new VisualLayout(
		{
			width: 200,
			height: 200,
			elements: [
				{ id: 'a', kind: EndpointKind.Node, bounds: box({ x: 0, y: 100, width: 80, height: 20 }) },
				{ id: 'b', kind: EndpointKind.Node, bounds: box({ x: 0, y: 0, width: 80, height: 20 }) },
			],
			relations: [{ id: 'a-b', from: 'a', to: 'b', points: points.map(point) }],
		},
		new Map([
			['a', 1],
			['b', 0],
		]),
		direction,
	);
}

describe.each(Object.values(LayoutDirection))('causal faces and flow in %s', (direction) => {
	it('accepts different port positions on principal faces', () => {
		for (const x of [24, 40, 56])
			AssertLayout(
				fixture(direction, [
					{ x, y: 100 },
					{ x, y: 20 },
				]),
			)
				.routes()
				.followLayoutFlow();
	});
	it('rejects attachments on lateral faces', () => {
		const points = [
			{ x: 0, y: 110 },
			{ x: -10, y: 110 },
			{ x: -10, y: 10 },
			{ x: 0, y: 10 },
		];
		expect(() => AssertLayout(fixture(direction, points)).routes().followLayoutFlow()).toThrow(
			'Face de départ',
		);
	});
	it('rejects the wrong principal arrival face', () => {
		expect(() =>
			AssertLayout(
				fixture(direction, [
					{ x: 40, y: 100 },
					{ x: 40, y: 0 },
				]),
			)
				.routes()
				.followLayoutFlow(),
		).toThrow('Face d’arrivée');
	});
	it('rejects a backwards portion even when the destination is upstream', () => {
		const points = [
			{ x: 24, y: 100 },
			{ x: 24, y: 50 },
			{ x: 40, y: 50 },
			{ x: 40, y: 60 },
			{ x: 56, y: 60 },
			{ x: 56, y: 20 },
		];
		expect(() => AssertLayout(fixture(direction, points)).routes().followLayoutFlow()).toThrow(
			'retour en arrière',
		);
	});
	it('requires departure and arrival segments to follow the principal axis', () => {
		const points = [
			{ x: 24, y: 100 },
			{ x: 40, y: 100 },
			{ x: 40, y: 20 },
		];
		expect(() => AssertLayout(fixture(direction, points)).routes().followLayoutFlow()).toThrow(
			'Attache sur l’axe principal',
		);
	});
	it('measures used ports independently of arrow count and checks their size demand', () => {
		const layout = fixture(direction, [
			{ x: 40, y: 100 },
			{ x: 40, y: 20 },
		]);
		const duplicate = new VisualLayout(
			{
				width: layout.width,
				height: layout.height,
				elements: layout.elements,
				relations: [...layout.relations, { ...defined(layout.relations[0]), id: 'second' }],
			},
			new Map([
				['a', 1],
				['b', 0],
			]),
			direction,
		);
		expect(usedPortCount(duplicate, 'a', 'outgoing')).toBe(1);
		expect(usedPortCount(duplicate, 'a', 'incoming')).toBe(0);
		AssertPorts(duplicate, 'a', 'outgoing').haveCountBetween(1, 2);
		expect(() => AssertPorts(duplicate, 'a', 'outgoing').haveCountBetween(2, 3)).toThrow('minimal');
		expect(() => AssertPorts(duplicate, 'a', 'outgoing').haveCountBetween(0, 0)).toThrow('maximal');
		AssertLayout(duplicate).node('a').hasSizeForUsedPorts({ content: 80, spacing: 48, inset: 24 });
		expect(() =>
			AssertLayout(duplicate)
				.node('a')
				.hasSizeForUsedPorts({ content: 100, spacing: 48, inset: 24 }),
		).toThrow('Dimension transversale');
	});
});

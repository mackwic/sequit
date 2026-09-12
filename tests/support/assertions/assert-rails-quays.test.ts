import { describe, expect, it } from 'vitest';

import { EndpointKind, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { Bounds, LayoutRelation, Point } from '../../../src/lib/core/layout/layout-types';
import { VisualLayout } from '../harnesses/visual-layout';
import { AssertLayout } from './assert-layout';
import { AssertQuays, AssertQuaySize } from './assert-quays';
import { AssertRails } from './assert-rails';
import { AssertTrunks } from './assert-trunks';

function fixture(
	direction = LayoutDirection.TopToBottom,
	ports = [24, 72],
	size = 96,
): VisualLayout {
	const horizontal = [LayoutDirection.LeftToRight, LayoutDirection.RightToLeft].includes(direction);
	const point = ({ x, y }: Point): Point => {
		if (horizontal) return { x: y, y: x };
		return { x, y };
	};
	const box = ({ x, y, width, height }: Bounds): Bounds => {
		if (horizontal) return { x: y, y: x, width: height, height: width };
		return { x, y, width, height };
	};
	return new VisualLayout(
		{
			width: 240,
			height: 240,
			elements: [
				{ id: 'a', kind: EndpointKind.Node, bounds: box({ x: 0, y: 0, width: size, height: 60 }) },
				{
					id: 'b',
					kind: EndpointKind.Node,
					bounds: box({ x: 0, y: 156, width: size, height: 60 }),
				},
			],
			relations: ports.map((port, index) => ({
				id: `r${index}`,
				from: 'a',
				to: 'b',
				points: [
					{ x: port, y: 60 },
					{ x: port, y: 96 + index * 24 },
					{ x: size - port, y: 96 + index * 24 },
					{ x: size - port, y: 156 },
				].map(point),
			})),
		},
		new Map([
			['a', 0],
			['b', 1],
		]),
		direction,
	);
}

const room = { baseGap: 72, spacing: 24, inset: 12 };
const rows = [['a'], ['b']] as const;

describe.each(Object.values(LayoutDirection))('rails and quays in %s', (direction) => {
	it('counts distinct anchors and checks centered, spaced incoming and outgoing quays', () => {
		const layout = fixture(direction);
		AssertQuays(layout, 'a', 'outgoing')
			.haveCount(2)
			.areCentered()
			.haveClearance({ spacing: 48, inset: 24 });
		AssertQuays(layout, 'b', 'incoming')
			.haveCount(2)
			.areCentered()
			.haveClearance({ spacing: 48, inset: 24 });
		AssertRails(layout, rows).haveCount(2).haveAtLeast(2).haveRoom(room);
	});
	it('does not count two coincident anchors as two quays', () => {
		const layout = fixture(direction, [48, 48]);
		AssertQuays(layout, 'a', 'outgoing').haveCount(1).areCentered();
		expect(() => AssertQuays(layout, 'a', 'outgoing').haveCount(2)).toThrow('Nombre de quais');
		expect(() => AssertRails(layout, rows).haveCount(1)).toThrow('Nombre de rails');
	});
	it('rejects insufficient rail spacing, room and boundary clearance', () => {
		const rails = AssertRails(fixture(direction), rows);
		expect(() => rails.haveRoom({ ...room, spacing: 25, baseGap: 60 })).toThrow('Espacement');
		expect(() => rails.haveRoom({ ...room, baseGap: 73 })).toThrow('Intervalle');
		expect(() => rails.haveRoom({ ...room, inset: 40 })).toThrow('Marge');
	});
});

it('rejects off-center, crowded and edge-adjacent quays independently', () => {
	expect(() => AssertQuays(fixture(undefined, [24, 60]), 'a', 'outgoing').areCentered()).toThrow(
		'Centre',
	);
	expect(() =>
		AssertQuays(fixture(undefined, [40, 56]), 'a', 'outgoing').haveClearance({
			spacing: 48,
			inset: 24,
		}),
	).toThrow('Espacement');
	expect(() =>
		AssertQuays(fixture(undefined, [12, 84]), 'a', 'outgoing').haveClearance({
			spacing: 48,
			inset: 24,
		}),
	).toThrow('Marge');
});

it('uses the maximum of content and the two faces, not their sum', () => {
	const options = { incoming: 2, outgoing: 3, content: 80, spacing: 48, inset: 24 };
	AssertQuaySize(fixture(undefined, [24, 72], 144), 'a').matchesContentAndQuays(options);
	AssertQuaySize(fixture(undefined, [24, 72], 200), 'a').matchesContentAndQuays({
		...options,
		content: 200,
	});
	expect(() => {
		AssertQuaySize(fixture(), 'a').matchesContentAndQuays(options);
	}).toThrow('Dimension');
	expect(() => {
		AssertQuaySize(fixture(undefined, [24, 72], 240), 'a').matchesContentAndQuays(options);
	}).toThrow('Dimension');
});

it('rejects absent quays and unrelated rows instead of passing vacuously', () => {
	expect(() => AssertQuays(fixture(), 'a', 'incoming')).toThrow('Aucun quai');
	expect(() => AssertRails(fixture(), [['a'], ['missing']])).toThrow('Aucune route');
});

it('requires a positive segment shared by every member of an explicitly allowed family', () => {
	const routes: LayoutRelation[] = [
		{
			id: 'a',
			from: 'root',
			to: 'left',
			points: [
				{ x: 0, y: 0 },
				{ x: 0, y: 20 },
				{ x: -20, y: 20 },
			],
		},
		{
			id: 'b',
			from: 'root',
			to: 'right',
			points: [
				{ x: 0, y: 0 },
				{ x: 0, y: 20 },
				{ x: 20, y: 20 },
			],
		},
	];
	AssertTrunks(routes).haveSharedSegment('y', 20);
	expect(() => {
		AssertTrunks(routes).haveSharedSegment('x', 1);
	}).toThrow('Longueur');
	expect(() => {
		AssertTrunks(routes).haveSharedSegment('y', 21);
	}).toThrow('Longueur');
	expect(() => AssertTrunks([])).toThrow('deux routes');
});

it('retains the reference while changing the observed elements', () => {
	const before = fixture();
	const after = fixture().withReference('Avant', before);
	expect(after.withElements(after.elements).reference).toEqual({ label: 'Avant', layout: before });
	expect(before.reference).toBeUndefined();
});

describe.each(Object.values(LayoutDirection))('fluent routing context in %s', (direction) => {
	it('keeps quay, node and rail subjects throughout their chains', () => {
		const layout = fixture(direction);
		const check = AssertLayout(layout);
		const outgoing = check.quays('a', { side: 'outgoing' });
		expect(outgoing.haveCount(2).areCentered().haveClearance({ spacing: 48, inset: 24 })).toBe(
			outgoing,
		);
		check
			.quays('b', { side: 'incoming' })
			.haveCount(2)
			.areCentered()
			.haveClearance({ spacing: 48, inset: 24 });
		const size = { content: 80, incoming: 2, outgoing: 2, spacing: 48, inset: 24 };
		const a = check.node('a');
		expect(a.hasSizeForQuays(size).hasRank(1)).toBe(a);
		const nodes = check.nodes(['a', 'b']);
		expect(nodes.haveSizeForQuays(size)).toBe(nodes);
		const rails = check.rails({ between: rows });
		expect(rails.haveCount(2).haveAtLeast(2).haveRoom(room)).toBe(rails);
		expect(() => check.node('a').hasSizeForQuays({ ...size, outgoing: 3 })).toThrow('Dimension');
		expect(() => check.nodes(['a', 'b']).haveSizeForQuays({ ...size, content: 200 })).toThrow(
			'Dimension',
		);
	});
	it('retains a deliberately failing quay expectation instead of masking it in the facade', () => {
		const check = AssertLayout(fixture(direction, [48, 48]));
		expect(() => check.quays('a', { side: 'outgoing' }).haveCount(2)).toThrow('Nombre de quais');
		expect(() => check.quays('a', { side: 'incoming' })).toThrow('Aucun quai');
	});
});

import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import { alignFamilies } from '../../../../src/lib/core/layout/placement/align-families';

function box(x: number, y: number): Bounds {
	return { x, y, width: 60, height: 20 };
}

function centers(bounds: ReadonlyMap<string, Bounds>): Record<string, number> {
	return Object.fromEntries([...bounds].map(([id, { x, width }]) => [id, x + width / 2]));
}

function align(
	rows: readonly (readonly string[])[],
	bounds: Map<string, Bounds>,
	arrows: readonly (readonly [from: string, to: string])[],
	options: {
		readonly junctionIds?: ReadonlySet<string>;
		readonly containers?: ReadonlyMap<string, string>;
	} = {},
): void {
	const parents = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	for (const [from, to] of arrows) {
		parents.set(from, [...(parents.get(from) ?? []), to]);
		children.set(to, [...(children.get(to) ?? []), from]);
	}
	const containers = options.containers ?? new Map<string, string>();
	alignFamilies({
		rows,
		adjacency: { parents, children, containerOf: (id) => containers.get(id) },
		junctionIds: options.junctionIds ?? new Set(),
		bounds,
		vertical: true,
	});
}

describe('family alignment', () => {
	it('leaves rows without relations in place', () => {
		const bounds = new Map([
			['a', box(0, 0)],
			['b', box(0, 100)],
			['c', box(96, 100)],
		]);
		const original = structuredClone(bounds);
		align([['a'], ['b', 'c']], bounds, []);
		expect(bounds).toEqual(original);
	});

	it('centers a family envelope on its parent and pushes an unrelated neighbor', () => {
		const bounds = new Map([
			['p', box(300, 0)],
			['a', box(0, 100)],
			['b', box(96, 100)],
			['free', box(192, 100)],
		]);
		align([['p'], ['a', 'b', 'free']], bounds, [
			['a', 'p'],
			['b', 'p'],
		]);
		expect(centers(bounds)).toEqual({ p: 330, a: 282, b: 378, free: 474 });
	});

	it('looks through a junction to the parent beyond it', () => {
		const bounds = new Map([
			['p', box(400, 0)],
			['a', box(0, 100)],
			['b', box(96, 100)],
		]);
		align(
			[['p'], ['a', 'b']],
			bounds,
			[
				['a', 'j'],
				['b', 'j'],
				['j', 'p'],
			],
			{ junctionIds: new Set(['j']) },
		);
		expect(centers(bounds)).toEqual({ p: 430, a: 382, b: 478 });
	});

	it('keeps a family in place when its parent belongs to another container', () => {
		const bounds = new Map([
			['p', box(400, 0)],
			['a', box(0, 100)],
			['b', box(96, 100)],
		]);
		const original = structuredClone(bounds);
		align(
			[['p'], ['a', 'b']],
			bounds,
			[
				['a', 'p'],
				['b', 'p'],
			],
			{
				containers: new Map([
					['a', 'group'],
					['b', 'group'],
				]),
			},
		);
		expect(bounds).toEqual(original);
	});

	it('spreads parents so that each wide family is centered beneath its own parent', () => {
		const bounds = new Map([
			['p', box(0, 0)],
			['q', box(96, 0)],
			['a', box(0, 100)],
			['b', box(96, 100)],
			['c', box(192, 100)],
			['d', box(288, 100)],
		]);
		align(
			[
				['p', 'q'],
				['a', 'b', 'c', 'd'],
			],
			bounds,
			[
				['a', 'p'],
				['b', 'p'],
				['c', 'q'],
				['d', 'q'],
			],
		);
		const center = (id: string) => defined(centers(bounds)[id]);
		expect((center('a') + center('b')) / 2).toBe(center('p'));
		expect((center('c') + center('d')) / 2).toBe(center('q'));
		expect(center('c') - center('b')).toBeGreaterThanOrEqual(96);
	});
});

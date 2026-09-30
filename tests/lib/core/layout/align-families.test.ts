import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import {
	alignFamilies,
	flatFamilyLinks,
} from '../../../../src/lib/core/layout/placement/align-families';

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
		readonly walls?: ReadonlySet<string>;
	} = {},
): void {
	const parents = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	for (const [from, to] of arrows) {
		parents.set(from, [...(parents.get(from) ?? []), to]);
		children.set(to, [...(children.get(to) ?? []), from]);
	}
	const junctionIds = options.junctionIds ?? new Set();
	alignFamilies({
		rows,
		links: flatFamilyLinks({ rows, parents, children, junctionIds }),
		bounds,
		vertical: true,
		isWall: (item) => options.walls?.has(item) === true,
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

	it('keeps a wall in place: a family aimed past it stays on its own side, its parent above it', () => {
		const bounds = new Map([
			['p', box(300, 0)],
			['a', box(0, 100)],
			['w', box(320, 100)],
		]);
		align([['p'], ['a', 'w']], bounds, [['a', 'p']], { walls: new Set(['w']) });
		expect(centers(bounds)).toEqual({ p: 30, a: 30, w: 350 });
	});

	it('slides a family toward a fixed parent against a wall, leaving a track for a long relation', () => {
		const layout = (arrows: readonly (readonly [string, string])[]) => {
			const bounds = new Map([
				['p', box(300, 0)],
				['a', box(0, 100)],
				['w', box(320, 100)],
				['z', box(0, 200)],
			]);
			align([['p'], ['a', 'w'], ['z']], bounds, arrows, { walls: new Set(['p', 'w']) });
			return centers(bounds);
		};
		// 350 - 60 - 36: one item gap before the wall.
		expect(layout([['a', 'p']])).toMatchObject({ p: 330, a: 254 });
		// 350 - 60 - 48: z-to-p spans the gap, which keeps a rail spacing on both sides of it.
		expect(
			layout([
				['a', 'p'],
				['z', 'p'],
			]),
		).toMatchObject({ p: 330, a: 242 });
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

	it('spreads a parent that cannot follow its blocked child so both families stay centered', () => {
		const bounds = new Map([
			['w', box(-30, 0)],
			['p2', box(66, 0)],
			['p3', box(162, 0)],
			['c2', box(0, 100)],
			['a', box(96, 100)],
			['b', box(192, 100)],
			['c', box(288, 100)],
		]);
		align(
			[
				['w', 'p2', 'p3'],
				['c2', 'a', 'b', 'c'],
			],
			bounds,
			[
				['c2', 'p2'],
				['a', 'p3'],
				['b', 'p3'],
				['c', 'p3'],
			],
			{ walls: new Set(['w']) },
		);
		const center = (id: string) => defined(centers(bounds)[id]);
		expect(center('c2')).toBe(center('p2'));
		expect((center('a') + center('c')) / 2).toBe(center('p3'));
	});
});

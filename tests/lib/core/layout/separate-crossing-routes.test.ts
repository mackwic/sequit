import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import { AssertRenderedPaths } from '../../../../src/app/workshop/visual-tests/asserts/assert-rendered-paths';
import { AssertRoute } from '../../../../src/app/workshop/visual-tests/asserts/assert-route';
import { AssertRoutes } from '../../../../src/app/workshop/visual-tests/asserts/assert-routes';
import { layoutNodes } from '../../../../src/app/workshop/visual-tests/layout-nodes';
import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { routePointsWithGroupHeaders } from '../../../../src/lib/core/layout/dedicated-layout-geometry';
import type { Bounds, LayoutRelation } from '../../../../src/lib/core/layout/layout-types';
import { separateCrossingRoutes } from '../../../../src/lib/core/layout/separate-crossing-routes';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

function separate(
	relations: readonly LayoutRelation[],
	bounds: ReadonlyMap<string, Bounds>,
	direction: LayoutDirection,
	excludedEndpoints: ReadonlySet<string>,
) {
	const ranks = new Map([
		['a', 0],
		['b', 0],
		['c', 1],
		['d', 1],
		['e', 0],
		['f', 1],
	]);
	return separateCrossingRoutes({ relations, bounds, direction, excludedEndpoints, ranks });
}

function fixture(direction: LayoutDirection, width = 100, height = 60) {
	const base = new Map<string, Bounds>([
		['a', { x: 40, y: 40, width, height }],
		['b', { x: 76 + width, y: 40, width, height }],
		['c', { x: 40, y: 112 + height, width, height }],
		['d', { x: 76 + width, y: 112 + height, width, height }],
	]);
	const bounds = new Map(
		[...base].map(([id, box]) => {
			let transformed = box;
			if (direction === LayoutDirection.BottomToTop)
				transformed = { ...box, y: 152 + height - box.y };
			if (direction === LayoutDirection.LeftToRight)
				transformed = { x: box.y, y: box.x, width: box.height, height: box.width };
			if (direction === LayoutDirection.RightToLeft)
				transformed = { x: 152 + height - box.y, y: box.x, width: box.height, height: box.width };
			return [id, transformed] as const;
		}),
	);
	const relations = [
		['a', 'c'],
		['a', 'd'],
		['b', 'c'],
		['b', 'd'],
	].map(([from, to]): LayoutRelation => {
		const sourceId = defined(from);
		const targetId = defined(to);
		return {
			id: `${sourceId}-${targetId}`,
			from: sourceId,
			to: targetId,
			points: routePointsWithGroupHeaders({
				source: defined(bounds.get(sourceId)),
				target: defined(bounds.get(targetId)),
				direction,
			}),
		};
	});
	return { bounds, relations };
}

function verifyRoutes(relations: readonly LayoutRelation[], bounds: ReadonlyMap<string, Bounds>) {
	AssertRoutes(relations).haveNoOverlap();
	AssertRoutes(relations.filter(({ id }) => id === 'a-d' || id === 'b-c')).haveCrossing();
	AssertRenderedPaths(renderRelationPaths(relations)).haveBridgeAtEveryCrossing();
	for (const relation of relations) {
		AssertRoute(relation)
			.isOrthogonal()
			.isAttachedTo(
				{ id: relation.from, bounds: defined(bounds.get(relation.from)) },
				{ id: relation.to, bounds: defined(bounds.get(relation.to)) },
			);
	}
}

describe.each(Object.values(LayoutDirection))('separated crossing routes in %s', (direction) => {
	it('separates the routes, keeps contour attachments and permits the real renderer to bridge', () => {
		const { bounds, relations } = fixture(direction);
		const original = structuredClone(relations);
		const result = separate(relations, bounds, direction, new Set());
		verifyRoutes(result, bounds);
		expect(relations).toEqual(original);
		const reordered = separate(
			[...relations].reverse(),
			new Map([...bounds].reverse()),
			direction,
			new Set(),
		);
		expect(reordered).toEqual([...result].reverse());
	});
	it('preserves simple fans and convergences including their intentional overlaps', () => {
		const { bounds, relations } = fixture(direction);
		for (const selected of [
			relations.filter(({ from }) => from === 'a'),
			relations.filter(({ to }) => to === 'c'),
		]) {
			const result = separate(selected, bounds, direction, new Set());
			result.forEach((relation, index) => {
				expect(relation).toBe(selected[index]);
			});
		}
	});
	it('retains group and junction attachments excluded by the caller', () => {
		const { bounds, relations } = fixture(direction);
		const result = separate(relations, bounds, direction, new Set(['c', 'd']));
		result.forEach((relation, index) => {
			expect(relation).toBe(relations[index]);
		});
	});
});

it('preserves separate corridors while coordinating an inverted corridor', () => {
	const direction = LayoutDirection.TopToBottom;
	const { bounds, relations } = fixture(direction);
	bounds.set('e', { x: 500, y: 40, width: 100, height: 60 });
	bounds.set('f', { x: 500, y: 172, width: 100, height: 60 });
	const independent: LayoutRelation = {
		id: 'e-f',
		from: 'e',
		to: 'f',
		points: routePointsWithGroupHeaders({
			source: defined(bounds.get('e')),
			target: defined(bounds.get('f')),
			direction,
		}),
	};
	const result = separate([...relations, independent], bounds, direction, new Set());
	expect(result.at(-1)).toBe(independent);
	verifyRoutes(result.slice(0, 4), bounds);
});

it('keeps routing stable over varied box dimensions and directions', () => {
	fc.assert(
		fc.property(
			fc.integer({ min: 60, max: 400 }),
			fc.integer({ min: 40, max: 250 }),
			fc.constantFrom(...Object.values(LayoutDirection)),
			(width, height, direction) => {
				const { relations, bounds } = fixture(direction, width, height);
				verifyRoutes(separate(relations, bounds, direction, new Set()), bounds);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('keeps ports within even very small endpoint contours', () => {
	const direction = LayoutDirection.TopToBottom;
	const { bounds, relations } = fixture(direction, 8, 8);
	for (const relation of separate(relations, bounds, direction, new Set())) {
		AssertRoute(relation)
			.isOrthogonal()
			.isAttachedTo(
				{ id: relation.from, bounds: defined(bounds.get(relation.from)) },
				{ id: relation.to, bounds: defined(bounds.get(relation.to)) },
			);
	}
});

it('separates crossings with unequal sizes on the actual layout pipeline', async () => {
	const size = fc.record({
		width: fc.integer({ min: 80, max: 300 }),
		height: fc.integer({ min: 60, max: 180 }),
	});
	await fc.assert(
		fc.asyncProperty(
			fc.record({ a: size, b: size, c: size, d: size }),
			fc.constantFrom(...Object.values(LayoutDirection)),
			async (nodes, direction) => {
				const layout = await layoutNodes({
					direction,
					nodes,
					relations: [
						{ id: 'a-c', from: 'a', to: 'c' },
						{ id: 'a-d', from: 'a', to: 'd' },
						{ id: 'b-c', from: 'b', to: 'c' },
						{ id: 'b-d', from: 'b', to: 'd' },
					],
				});
				verifyRoutes(
					layout.relations,
					new Map(layout.elements.map(({ id, bounds }) => [id, bounds])),
				);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

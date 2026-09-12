import { describe, expect, it } from 'vitest';

import type { BoxGeometry } from '../../../src/app/workshop/visual-tests/assert-box';
import { AssertRoute } from '../../../src/app/workshop/visual-tests/assert-route';
import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';

const source: BoxGeometry = { id: 'a', bounds: { x: 0, y: 0, width: 100, height: 60 } };
const target: BoxGeometry = { id: 'b', bounds: { x: 0, y: 160, width: 100, height: 60 } };
const route: LayoutRelation = {
	id: 'a-b',
	from: 'a',
	to: 'b',
	points: [
		{ x: 50, y: 60 },
		{ x: 50, y: 160 },
	],
};

describe('calculated route assertions', () => {
	it('checks orthogonality and attachment to the intended endpoint contours', () => {
		const assertions = AssertRoute(route);
		expect(assertions.isOrthogonal().isAttachedTo(source, target)).toBe(assertions);
	});
	it.each([
		{ from: 'wrong', to: 'b', points: route.points },
		{ from: 'a', to: 'wrong', points: route.points },
		{
			from: 'a',
			to: 'b',
			points: [
				{ x: 50, y: 30 },
				{ x: 50, y: 160 },
			],
		},
		{
			from: 'a',
			to: 'b',
			points: [
				{ x: 50, y: 60 },
				{ x: 50, y: 180 },
			],
		},
		{ from: 'a', to: 'b', points: [] },
	])('rejects wrong identities or attachment points: %j', (invalid) => {
		expect(() => {
			AssertRoute({ id: 'a-b', ...invalid }).isAttachedTo(source, target);
		}).toThrow('not attached');
	});
	it('rejects a diagonal route', () => {
		expect(() => {
			AssertRoute({
				...route,
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 10 },
				],
			}).isOrthogonal();
		}).toThrow('orthogonal');
	});
	it('accepts horizontal attachment and refuses invalid box dimensions', () => {
		const horizontal = {
			...route,
			points: [
				{ x: 100, y: 30 },
				{ x: 200, y: 30 },
			],
		};
		const right = { ...target, bounds: { x: 200, y: 0, width: 100, height: 60 } };
		AssertRoute(horizontal).isAttachedTo(source, right);
		expect(() => {
			AssertRoute(horizontal).isAttachedTo(
				{ ...source, bounds: { ...source.bounds, width: -1 } },
				right,
			);
		}).toThrow('source');
	});
});

it('requires a single straight run on the requested axis', () => {
	const assertions = AssertRoute(route);
	expect(assertions.isStraightAlong('y')).toBe(assertions);
	expect(() => assertions.isStraightAlong('x')).toThrow('rectiligne');
	expect(() =>
		AssertRoute({
			...route,
			points: [
				{ x: 50, y: 60 },
				{ x: 50, y: 100 },
				{ x: 60, y: 100 },
				{ x: 60, y: 160 },
			],
		}).isStraightAlong('y'),
	).toThrow('rectiligne');
	AssertRoute({
		...route,
		points: [
			{ x: 0, y: 20 },
			{ x: 50, y: 20 },
			{ x: 100, y: 20 },
		],
	}).isStraightAlong('x');
});

it('exposes the route, expectation and observed axes as structured diagnostic fields', () => {
	expect.assertions(1);
	try {
		AssertRoute(route).isStraightAlong('x');
	} catch (error) {
		expect(error).toMatchObject({
			name: 'VisualAssertionError',
			subject: 'Route "a-b" · tracé rectiligne',
			targets: { routes: ['a-b'] },
			expected: 'un segment rectiligne sur x',
			actual: '1 segments (axes : y)',
		});
	}
});

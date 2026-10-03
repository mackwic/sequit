import { describe, expect, it } from 'vitest';

import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';
import { AssertRoutes } from './assert-routes';
import { phantomRelations } from './route-networks';

function route(
	from: string,
	to: string,
	points: readonly (readonly [number, number])[],
): LayoutRelation {
	return { id: `${from}-${to}`, from, to, points: points.map(([x, y]) => ({ x, y })) };
}

/** A leaves through one port, then branches to X on the left and Y on the right. */
const fork = [
	route('a', 'x', [
		[50, 0],
		[50, 20],
		[20, 20],
		[20, 60],
	]),
	route('a', 'y', [
		[50, 0],
		[50, 20],
		[80, 20],
		[80, 60],
	]),
];
/** B joins the arrival trunk of A → X from the left. */
const convergingOnX = route('b', 'x', [
	[0, 0],
	[0, 40],
	[20, 40],
	[20, 60],
]);

describe('relations suggested by shared ink', () => {
	it('accepts a fork sharing its departure trunk', () => {
		AssertRoutes(fork).haveNoPhantomRelation();
	});
	it('rejects a convergence joining a branched trunk: B seems to reach Y', () => {
		expect(phantomRelations([...fork, convergingOnX])).toEqual([
			{ from: 'b', to: 'y', network: ['a-x', 'a-y', 'b-x'] },
		]);
		expect(() => AssertRoutes([...fork, convergingOnX]).haveNoPhantomRelation()).toThrow('b -> y');
	});
	it('accepts the same network once every suggested relation is drawn', () => {
		const complete = route('b', 'y', [
			[0, 0],
			[0, 40],
			[80, 40],
			[80, 60],
		]);
		AssertRoutes([...fork, convergingOnX, complete]).haveNoPhantomRelation();
	});
	it('does not join two routes at a strict crossing', () => {
		const crossing = route('g', 'h', [
			[35, -10],
			[35, 60],
		]);
		AssertRoutes([...fork, crossing]).haveNoPhantomRelation();
	});
	it('does not turn a crossing into a contact for a collinear intermediate point', () => {
		const crossing = route('g', 'h', [
			[35, -10],
			[35, 20],
			[35, 60],
		]);
		AssertRoutes([...fork, crossing]).haveNoPhantomRelation();
	});
	it('joins a route ending on another run, whatever the arrow directions', () => {
		const contact = route('g', 'h', [
			[35, 60],
			[35, 20],
		]);
		expect(phantomRelations([...fork, contact]).map(({ from, to }) => `${from}-${to}`)).toEqual([
			'a-h',
			'g-x',
			'g-y',
		]);
	});
});

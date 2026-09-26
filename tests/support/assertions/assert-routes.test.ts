import { describe, expect, it } from 'vitest';

import type { LayoutRelation, Point } from '../../../src/lib/core/layout/layout-types';
import { AssertRoutes } from './assert-routes';

function route(id: string, points: readonly Point[]): LayoutRelation {
	return { id, from: `${id}-source`, to: `${id}-target`, points };
}
const horizontal = route('horizontal', [
	{ x: 0, y: 50 },
	{ x: 100, y: 50 },
]);
const vertical = route('vertical', [
	{ x: 50, y: 0 },
	{ x: 50, y: 100 },
]);

describe('route collection assertions', () => {
	it('accepts a crossing of routes with no overlap', () => {
		AssertRoutes([horizontal, vertical]).haveNoOverlap();
		AssertRoutes([horizontal, vertical]).haveCrossing();
	});
	it.each([
		route('overlap', [
			{ x: 80, y: 50 },
			{ x: 20, y: 50 },
		]),
		route('partial', [
			{ x: 80, y: 50 },
			{ x: 120, y: 50 },
		]),
	])('rejects a segment overlap on $id', (other) => {
		expect(() => {
			AssertRoutes([horizontal, other]).haveNoOverlap();
		}).toThrow('overlap');
	});
	it('rejects a vertical segment overlap', () => {
		const other = route('overlap', [
			{ x: 50, y: 20 },
			{ x: 50, y: 80 },
		]);
		expect(() => {
			AssertRoutes([vertical, other]).haveNoOverlap();
		}).toThrow('overlap');
	});
	it('allows a common endpoint without confusing it with a crossing', () => {
		const continuation = route('continuation', [
			{ x: 100, y: 50 },
			{ x: 100, y: 80 },
		]);
		AssertRoutes([horizontal, continuation]).haveNoOverlap();
		expect(() => {
			AssertRoutes([horizontal, continuation]).haveCrossing();
		}).toThrow('Expected a crossing');
	});
	it('rejects a T-contact that has no proper crossing or overlapping segment', () => {
		const touching = route('touching', [
			{ x: 50, y: 50 },
			{ x: 100, y: 50 },
		]);
		AssertRoutes([vertical, touching]).haveNoCrossing().haveNoOverlap();
		expect(() => AssertRoutes([vertical, touching]).haveNoForbiddenContacts()).toThrow(
			'Contacts entre routes sans pont',
		);
	});
	it('allows a continuous shared incoming trunk from the same target', () => {
		const left = {
			...route('left', [
				{ x: 0, y: 50 },
				{ x: 50, y: 50 },
				{ x: 50, y: 0 },
			]),
			to: 'common',
		};
		const right = {
			...route('right', [
				{ x: 100, y: 50 },
				{ x: 50, y: 50 },
				{ x: 50, y: 0 },
			]),
			to: 'common',
		};
		AssertRoutes([left, right]).haveNoForbiddenContacts();
	});
	it('rejects parallel routes with no crossing', () => {
		const other = route('parallel', [
			{ x: 0, y: 80 },
			{ x: 100, y: 80 },
		]);
		AssertRoutes([horizontal, other]).haveNoOverlap();
		expect(() => {
			AssertRoutes([horizontal, other]).haveCrossing();
		}).toThrow('Expected a crossing');
	});
	it('allows collinear routes which only touch at their endpoints', () => {
		AssertRoutes([
			horizontal,
			route('next', [
				{ x: 100, y: 50 },
				{ x: 150, y: 50 },
			]),
		]).haveNoOverlap();
	});
	it('ignores repeated points and overlapping segments belonging to the same relation', () => {
		const repeated = route('repeated', [
			{ x: 0, y: 50 },
			{ x: 0, y: 50 },
			{ x: 100, y: 50 },
			{ x: 0, y: 50 },
		]);
		AssertRoutes([repeated, vertical]).haveNoOverlap();
	});
	it.each([
		route('empty', []),
		route('point', [{ x: 0, y: 0 }]),
		route('diagonal', [
			{ x: 0, y: 0 },
			{ x: 100, y: 100 },
		]),
		route('invalid', [
			{ x: NaN, y: 0 },
			{ x: 100, y: 0 },
		]),
	])('refuses invalid route $id', (invalid) => {
		expect(() => {
			AssertRoutes([horizontal, invalid]).haveNoOverlap();
		}).toThrow();
	});
	it('refuses a vacuous check', () => {
		expect(() => AssertRoutes([horizontal]).haveNoCrossing()).toThrow('at least 2');
	});
});

it('finds a crossing at an intermediate collinear point', () => {
	const split = route('split', [
		{ x: 0, y: 50 },
		{ x: 50, y: 50 },
		{ x: 100, y: 50 },
	]);
	AssertRoutes([split, vertical]).haveCrossing();
	expect(() => {
		AssertRoutes([split, vertical]).haveNoCrossing();
	}).toThrow('without crossings');
});

it('allows a shared-source trunk when only absence of crossings is required', () => {
	const a = { ...horizontal, from: 'shared' };
	const b = {
		...route('branch', [
			{ x: 0, y: 50 },
			{ x: 50, y: 50 },
			{ x: 50, y: 100 },
		]),
		from: 'shared',
	};
	AssertRoutes([a, b]).haveNoCrossing();
	expect(() => {
		AssertRoutes([a, b]).haveNoOverlap();
	}).toThrow('overlap');
});

it('checks only interactions between the selected collections', () => {
	const outside = route('outside', [
		{ x: 200, y: 0 },
		{ x: 200, y: 100 },
	]);
	AssertRoutes([horizontal, vertical]).haveNoCrossingWith([outside]);
	AssertRoutes([horizontal, vertical]).haveNoOverlapWith([outside]);
	const crossing = route('crossing', [
		{ x: 75, y: 0 },
		{ x: 75, y: 100 },
	]);
	expect(() => {
		AssertRoutes([horizontal, vertical]).haveNoCrossingWith([crossing]);
	}).toThrow('between the route collections');
	const overlap = route('overlap', [
		{ x: 20, y: 50 },
		{ x: 80, y: 50 },
	]);
	expect(() => {
		AssertRoutes([horizontal, vertical]).haveNoOverlapWith([overlap]);
	}).toThrow('overlap');
});

it('rejects empty comparison sets and ambiguous route identities', () => {
	expect(() => AssertRoutes([horizontal, horizontal])).toThrow('unique');
	expect(() => {
		AssertRoutes([horizontal, vertical]).haveNoCrossingWith([]);
	}).toThrow('at least 1');
	expect(() => {
		AssertRoutes([horizontal, vertical]).haveNoOverlapWith([]);
	}).toThrow('at least 1');
	expect(() => {
		AssertRoutes([horizontal, vertical]).haveNoOverlapWith([horizontal]);
	}).toThrow('unique');
});

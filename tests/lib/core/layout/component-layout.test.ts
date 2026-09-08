import { describe, expect, it } from 'vitest';

import {
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { layoutComponent } from '../../../../src/lib/core/layout/component-layout';
import type { Bounds, Size } from '../../../../src/lib/core/layout/layout-types';
import { deriveEndpointRows } from '../../../../src/lib/core/ordering/endpoint-order';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';

const MINIMUM_JUNCTION_CLEARANCE = 18;

const ids = ['a', 'z', 'junction'] as const;
const ranks = new Map<string, number>([
	['a', 0],
	['z', 0],
	['junction', 0],
]);
const junctionIds = new Set(['junction']);
const sizes = new Map<string, Size>(ids.map((id) => [id, { width: 20, height: 20 }]));

it('rejects a component endpoint without a valid rank', () => {
	expect(() => deriveEndpointRows(['missing'], ['missing'], new Map(), new Set(), 0)).toThrow(
		'Invalid layout rank: missing',
	);
});

function bounds(
	direction: LayoutDirection.TopToBottom | LayoutDirection.BottomToTop,
): ReadonlyMap<string, Bounds> {
	const rows = deriveEndpointRows(['z', 'a', 'junction'], ids, ranks, junctionIds, 0);
	return layoutComponent(rows, sizes, direction, LayoutBias.Top, [20]).boundsById;
}

interface JunctionLayoutFixture {
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly width: number;
	readonly height: number;
}

function isVertical(direction: LayoutConfiguration['direction']): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
}

function isForward(direction: LayoutConfiguration['direction']): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.LeftToRight;
}

function physicalPrimaryStart(bounds: Bounds, direction: LayoutConfiguration['direction']): number {
	if (isVertical(direction)) return bounds.y;
	return bounds.x;
}

function physicalPrimaryEnd(bounds: Bounds, direction: LayoutConfiguration['direction']): number {
	let size = bounds.width;
	if (isVertical(direction)) size = bounds.height;
	return physicalPrimaryStart(bounds, direction) + size;
}

function forwardPrimaryStart(bounds: Bounds, direction: LayoutConfiguration['direction']): number {
	if (isForward(direction)) return physicalPrimaryStart(bounds, direction);
	return -physicalPrimaryEnd(bounds, direction);
}

function forwardPrimaryEnd(bounds: Bounds, direction: LayoutConfiguration['direction']): number {
	if (isForward(direction)) return physicalPrimaryEnd(bounds, direction);
	return -physicalPrimaryStart(bounds, direction);
}

function componentPrimarySize(
	layout: JunctionLayoutFixture,
	direction: LayoutConfiguration['direction'],
): number {
	if (isVertical(direction)) return layout.height;
	return layout.width;
}

function expectPrimaryClearance(
	before: Bounds,
	after: Bounds,
	direction: LayoutConfiguration['direction'],
): void {
	expect(
		forwardPrimaryStart(after, direction) - forwardPrimaryEnd(before, direction),
	).toBeGreaterThanOrEqual(MINIMUM_JUNCTION_CLEARANCE);
}

function expectContainedOnPrimaryAxis(
	bounds: Bounds,
	layout: JunctionLayoutFixture,
	direction: LayoutConfiguration['direction'],
): void {
	expect(physicalPrimaryStart(bounds, direction)).toBeGreaterThanOrEqual(0);
	expect(physicalPrimaryEnd(bounds, direction)).toBeLessThanOrEqual(
		componentPrimarySize(layout, direction),
	);
}

function expectTrailingClearance(
	bounds: Bounds,
	layout: JunctionLayoutFixture,
	direction: LayoutConfiguration['direction'],
): void {
	let clearance = physicalPrimaryStart(bounds, direction);
	if (isForward(direction)) {
		clearance = componentPrimarySize(layout, direction) - physicalPrimaryEnd(bounds, direction);
	}
	expect(clearance).toBeGreaterThanOrEqual(MINIMUM_JUNCTION_CLEARANCE);
}

const junctionFixtureSizes = [
	{ width: 108, height: 24 },
	{ width: 24, height: 108 },
] as const satisfies readonly Size[];

function layoutJunctionFixture(
	configuration: LayoutConfiguration,
	terminal: boolean,
): JunctionLayoutFixture {
	const startSize = { width: 80, height: 40 } as const;
	const endSize = { width: 120, height: 56 } as const;
	const junctionFixtureIds = junctionFixtureSizes.map((_, index) => `junction-${index}`);
	const sizeEntries: [string, Size][] = [['start', startSize]];
	if (!terminal) sizeEntries.push(['end', endSize]);
	junctionFixtureIds.forEach((id, index) => {
		const size = junctionFixtureSizes[index];
		if (size === undefined) throw new Error(`Missing junction size ${index}`);
		sizeEntries.push([id, size]);
	});
	const fixtureSizes = new Map<string, Size>(sizeEntries);
	const primarySize = (size: Size): number => {
		if (isVertical(configuration.direction)) return size.height;
		return size.width;
	};
	let ordinary = [['start'], ['end']];
	let junction = [junctionFixtureIds, []] as readonly (readonly string[])[];
	let primarySizes = [primarySize(startSize), primarySize(endSize)];
	if (terminal) {
		ordinary = [['start']];
		junction = [junctionFixtureIds];
		primarySizes = [primarySize(startSize)];
	}
	const result = layoutComponent(
		{ ordinary, junction },
		fixtureSizes,
		configuration.direction,
		configuration.bias,
		primarySizes,
	);
	return { bounds: result.boundsById, width: result.width, height: result.height };
}

describe('component layout endpoint order', () => {
	it('rejects rows that do not align with the primary rank bands', () => {
		expect(() =>
			layoutComponent(
				{ ordinary: [[]], junction: [] },
				new Map(),
				LayoutDirection.TopToBottom,
				LayoutBias.Top,
				[20],
			),
		).toThrow('Component rows must align with primary rank bands');
	});

	it('rejects ordinary and junction endpoints without measured sizes', () => {
		const configuration = [LayoutDirection.TopToBottom, LayoutBias.Top, [20]] as const;
		expect(() =>
			layoutComponent({ ordinary: [['missing']], junction: [[]] }, new Map(), ...configuration),
		).toThrow('Missing measured size: missing');
		expect(() =>
			layoutComponent({ ordinary: [[]], junction: [['missing']] }, new Map(), ...configuration),
		).toThrow('Missing measured size: missing');
	});

	it('uses the supplied endpoint order', () => {
		expect(bounds(LayoutDirection.TopToBottom).get('z')?.x).toBeLessThan(
			bounds(LayoutDirection.TopToBottom).get('a')?.x ?? 0,
		);
	});

	it('keeps ordinary and junction rows separate at the same rank', () => {
		const rows = deriveEndpointRows(['junction', 'z', 'a'], ids, ranks, junctionIds, 0);
		expect(rows.ordinary).toEqual([['z', 'a']]);
		expect(rows.junction).toEqual([['junction']]);
		const result = layoutComponent(rows, sizes, LayoutDirection.TopToBottom, LayoutBias.Top, [20]);
		const ordinary = result.boundsById.get('z');
		const junction = result.boundsById.get('junction');
		expect(junction?.x).toBe(28);
		if (!ordinary || !junction) throw new Error('Expected ordinary and junction bounds');
		expectPrimaryClearance(ordinary, junction, LayoutDirection.TopToBottom);
	});

	it('does not reverse cross-axis order for a reverse rank direction', () => {
		const forward = bounds(LayoutDirection.TopToBottom);
		const reverse = bounds(LayoutDirection.BottomToTop);
		expect(forward.get('z')?.x).toBeLessThan(forward.get('a')?.x ?? 0);
		expect(reverse.get('z')?.x).toBeLessThan(reverse.get('a')?.x ?? 0);
	});
});

describe.each(LAYOUT_CONFIGURATIONS)(
	'junction primary bands with $direction and $bias bias',
	(configuration) => {
		it('uses the direction-specific junction size between ordinary ranks with minimum clearance', () => {
			const layout = layoutJunctionFixture(configuration, false);
			const start = layout.bounds.get('start');
			const end = layout.bounds.get('end');
			const small = layout.bounds.get('junction-0');
			const oversized = layout.bounds.get('junction-1');
			if (!start || !end || !small || !oversized) throw new Error('Expected all fixture bounds');

			for (const junction of [small, oversized]) {
				expectPrimaryClearance(start, junction, configuration.direction);
				expectPrimaryClearance(junction, end, configuration.direction);
				expectContainedOnPrimaryAxis(junction, layout, configuration.direction);
			}
		});

		it('places terminal junctions after the final ordinary band and includes them in dimensions', () => {
			const layout = layoutJunctionFixture(configuration, true);
			const start = layout.bounds.get('start');
			const small = layout.bounds.get('junction-0');
			const oversized = layout.bounds.get('junction-1');
			if (!start || !small || !oversized) throw new Error('Expected all fixture bounds');

			for (const junction of [small, oversized]) {
				expectPrimaryClearance(start, junction, configuration.direction);
				expectContainedOnPrimaryAxis(junction, layout, configuration.direction);
				expectTrailingClearance(junction, layout, configuration.direction);
			}
		});
	},
);

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { RoutingEdge } from '../../../../src/lib/core/layout/geometry/routing-edge';
import {
	trackAllocationProductCount,
	trackAllocationProducts,
	type TrackAssignmentDomain,
} from '../../../../src/lib/core/layout/lanes/shared-lane-allocation-search';
import type { RoutingTrackAllocation } from '../../../../src/lib/core/layout/resources/routing-resource-allocation';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

interface AllocationPropertyCase {
	readonly totalRoutes: number;
	readonly firstBandRoutes: number;
	readonly firstPadding: number;
	readonly secondPadding: number;
}

function domain(
	id: string,
	relationIds: readonly string[],
	trackCount: number,
): TrackAssignmentDomain {
	const edge: RoutingEdge = { ownerId: id, capacity: trackCount, spacing: 24 };
	let shift = 0;
	if (trackCount > 1) shift = 1;
	const baselineTracks = relationIds.map((relationId, index): readonly [string, number] => [
		relationId,
		(index + shift) % trackCount,
	]);
	const baseline: RoutingTrackAllocation = {
		edge,
		trackByKey: new Map(baselineTracks),
	};
	return { id, edge, trackCount, relationIds, baseline };
}

type TrackAssignment = readonly (readonly [string, number])[];

function injections(
	relationIds: readonly string[],
	trackCount: number,
): readonly TrackAssignment[] {
	const sortedIds = [...relationIds].sort();
	const results: TrackAssignment[] = [];
	const tracks: number[] = [];
	const used = new Set<number>();
	function visit(index: number): void {
		if (index === sortedIds.length) {
			results.push(
				sortedIds.map((id, route) => {
					const track = tracks[route];
					if (track === undefined) throw new Error('Missing an exhaustive route track.');
					return [id, track] as const;
				}),
			);
			return;
		}
		for (let track = 0; track < trackCount; track += 1) {
			if (used.has(track)) continue;
			used.add(track);
			tracks[index] = track;
			visit(index + 1);
			used.delete(track);
		}
	}
	visit(0);
	return results;
}

function cartesian<T>(values: readonly (readonly T[])[]): readonly T[][] {
	let products: T[][] = [[]];
	for (const band of values)
		products = products.flatMap((prefix) => band.map((assignment) => [...prefix, assignment]));
	return products;
}

function encodedProduct(
	allocations: readonly RoutingTrackAllocation[],
	domains: readonly TrackAssignmentDomain[],
): string {
	return JSON.stringify(
		domains.map((domain, index) => [
			domain.id,
			[...domain.relationIds].sort().map((id) => [id, allocations[index]?.trackByKey.get(id)]),
		]),
	);
}

const propertyCase = fc
	.tuple(
		fc.integer({ min: 0, max: 4 }),
		fc.integer({ min: 0, max: 4 }),
		fc.integer({ min: 0, max: 2 }),
		fc.integer({ min: 0, max: 2 }),
	)
	.filter(([totalRoutes, split]) => split <= totalRoutes)
	.map(([totalRoutes, firstBandRoutes, firstPadding, secondPadding]): AllocationPropertyCase => ({
		totalRoutes,
		firstBandRoutes,
		firstPadding,
		secondPadding,
	}));

function trackCapacity(relationIds: readonly string[], padding: number): number {
	let availablePadding = padding;
	if (relationIds.length > 0 && availablePadding < 1) availablePadding = 1;
	return relationIds.length + availablePadding;
}
function domainsFor(value: AllocationPropertyCase): readonly TrackAssignmentDomain[] {
	const first = Array.from({ length: value.firstBandRoutes }, (_, index) => `a-${index}`);
	const second = Array.from(
		{ length: value.totalRoutes - value.firstBandRoutes },
		(_, index) => `b-${index}`,
	);
	return [
		domain('gutter', first, trackCapacity(first, value.firstPadding)),
		domain('rail', second, trackCapacity(second, value.secondPadding)),
	];
}

describe('shared lane allocation search property', () => {
	it('matches independent exhaustive injections for zero through four routes', () => {
		const empty = domain('empty', [], 0);
		expect(
			[...trackAllocationProducts([empty])].map(({ allocations }) =>
				encodedProduct(allocations, [empty]),
			),
		).toEqual(['[["empty",[]]]']);

		fc.assert(
			fc.property(propertyCase, (value) => {
				const domains = domainsFor(value);
				const actual = [...trackAllocationProducts(domains)];
				const expectedBands = domains.map((entry) =>
					injections(entry.relationIds, entry.trackCount),
				);
				const expected = cartesian(expectedBands).map((assignments) =>
					JSON.stringify(domains.map((entry, index) => [entry.id, assignments[index] ?? []])),
				);
				const actualKeys = actual.map(({ allocations }) => encodedProduct(allocations, domains));
				for (const entry of domains) {
					if (entry.relationIds.length === 0) continue;
					expect([...entry.baseline.trackByKey.values()]).not.toEqual(
						entry.relationIds.map((_, index) => index),
					);
				}
				expect(actualKeys[0]).toBe(
					encodedProduct(
						domains.map(({ baseline }) => baseline),
						domains,
					),
				);
				expect(new Set(actualKeys).size).toBe(actualKeys.length);
				expect([...actualKeys].sort()).toEqual([...expected].sort());
				expect(trackAllocationProductCount(domains)).toBe(BigInt(expected.length));

				const permuted = domains.map((entry) => ({
					...entry,
					relationIds: [...entry.relationIds].reverse(),
					baseline: {
						...entry.baseline,
						trackByKey: new Map([...entry.baseline.trackByKey].reverse()),
					},
				}));
				expect([...trackAllocationProducts(permuted)].map(({ key }) => key)).toEqual(
					actual.map(({ key }) => key),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});

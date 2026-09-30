import { describe, expect, it } from 'vitest';

import type { RoutingEdge } from '../../../../src/lib/core/layout/geometry/routing-edge';
import {
	trackAllocationProductCount,
	trackAllocationProducts,
	type TrackAssignmentDomain,
} from '../../../../src/lib/core/layout/lanes/shared-lane-allocation-search';
import type { RoutingTrackAllocation } from '../../../../src/lib/core/layout/resources/routing-resource-allocation';

function domain(
	id: string,
	keys: readonly string[],
	baselineTracks: readonly (readonly [string, number])[],
	trackCount: number,
): TrackAssignmentDomain {
	const edge: RoutingEdge = { ownerId: id, capacity: trackCount, spacing: 24 };
	const baseline: RoutingTrackAllocation = {
		edge,
		trackByKey: new Map(baselineTracks),
	};
	return { id, edge, trackCount, keys, baseline };
}

describe('shared lane allocation search', () => {
	it('yields each effective band product once, with the historical assignment first', () => {
		const domains = [
			domain(
				'gutter',
				['b-to-a', 'a-to-b'],
				[
					['b-to-a', 1],
					['a-to-b', 0],
				],
				2,
			),
			domain('rail', ['a-to-b'], [['a-to-b', 0]], 2),
		];
		const products = [...trackAllocationProducts(domains)];
		expect(trackAllocationProductCount(domains)).toBe(4n);
		expect(products).toHaveLength(4);
		expect(new Set(products.map(({ key }) => key)).size).toBe(4);
		expect(products[0]?.allocations.map(({ trackByKey }) => [...trackByKey])).toEqual([
			[
				['b-to-a', 1],
				['a-to-b', 0],
			],
			[['a-to-b', 0]],
		]);
		const permutedDomains = [
			domain(
				'gutter',
				['a-to-b', 'b-to-a'],
				[
					['a-to-b', 0],
					['b-to-a', 1],
				],
				2,
			),
			domain('rail', ['a-to-b'], [['a-to-b', 0]], 2),
		];
		expect([...trackAllocationProducts(permutedDomains)].map(({ key }) => key).sort()).toEqual(
			products.map(({ key }) => key).sort(),
		);
	});

	it('keeps allocation tie keys independent of relation IDs at each documentary position', () => {
		const original = domain(
			'gutter',
			['z-route', 'a-route'],
			[
				['z-route', 0],
				['a-route', 1],
			],
			2,
		);
		const renamed = domain(
			'gutter',
			['first-relation', 'second-relation'],
			[
				['first-relation', 0],
				['second-relation', 1],
			],
			2,
		);
		expect([...trackAllocationProducts([renamed])].map(({ key }) => key)).toEqual(
			[...trackAllocationProducts([original])].map(({ key }) => key),
		);
	});

	it('enumerates deep route bands without recursive stack growth', () => {
		const ids = Array.from({ length: 1000 }, (_, index) => `r-${index}`);
		const tracks = ids.map((relationId, track): readonly [string, number] => [relationId, track]);
		const products = trackAllocationProducts([domain('gutter', ids, tracks, ids.length)]);
		const baseline = products.next();
		const alternative = products.next();
		if (baseline.done === true || alternative.done === true)
			throw new Error('Expected a baseline followed by an alternate allocation.');
		expect(alternative.value.key).not.toBe(baseline.value.key);
	});

	it('counts factorial products exactly beyond safe number cardinality', () => {
		const ids = Array.from({ length: 16 }, (_, index) => `r-${index}`);
		const tracks = ids.map((relationId, track): readonly [string, number] => [relationId, track]);
		const factorial = ids.reduce((count, _id, index) => count * BigInt(index + 1), 1n);
		const count = trackAllocationProductCount([
			domain('gutter', ids, tracks, ids.length),
			domain('rail', ids, tracks, ids.length),
		]);
		expect(count).toBe(factorial * factorial);
		expect(count).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
	});
});

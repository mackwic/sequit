import { describe, expect, it } from 'vitest';

import {
	type FaceCapacityInput,
	threeIncidenceFaceCapacity,
} from '../../../../src/lib/core/layout/routing/face-capacity';

const face: FaceCapacityInput = {
	endpointId: 'target',
	role: 'incoming',
	incidences: [
		{ relationId: 'c', oppositeEndpointId: 'C' },
		{ relationId: 'a', oppositeEndpointId: 'A' },
		{ relationId: 'b', oppositeEndpointId: 'B' },
	],
	intrinsicCrossSize: 80,
	inset: 24,
	spacing: 48,
};

describe('three-incidence face capacity', () => {
	it('enumerates all five canonical partitions with their intrinsic size demands', () => {
		const contract = threeIncidenceFaceCapacity(face);
		expect(contract.incidences.map(({ relationId }) => relationId)).toEqual(['a', 'b', 'c']);
		expect(contract.alternatives.map(({ portGroups }) => portGroups)).toEqual([
			[['a', 'b', 'c']],
			[['a', 'b'], ['c']],
			[['a', 'c'], ['b']],
			[['a'], ['b', 'c']],
			[['a'], ['b'], ['c']],
		]);
		expect(contract.alternatives.map(({ metricDemand }) => metricDemand)).toEqual([
			{ minimumCrossSize: 80, growth: 0 },
			{ minimumCrossSize: 96, growth: 16 },
			{ minimumCrossSize: 96, growth: 16 },
			{ minimumCrossSize: 96, growth: 16 },
			{ minimumCrossSize: 144, growth: 64 },
		]);
		expect(
			contract.alternatives.every(({ respectsRequiredSeparations }) => respectsRequiredSeparations),
		).toBe(true);
	});

	it('marks only compatible alternatives when routing requires separation', () => {
		const onePair = threeIncidenceFaceCapacity({
			...face,
			requiredSeparations: [{ firstRelationId: 'a', secondRelationId: 'b' }],
		});
		expect(
			onePair.alternatives.map(({ respectsRequiredSeparations }) => respectsRequiredSeparations),
		).toEqual([false, false, true, true, true]);
		const allPairs = threeIncidenceFaceCapacity({
			...face,
			requiredSeparations: [
				{ firstRelationId: 'a', secondRelationId: 'b' },
				{ firstRelationId: 'a', secondRelationId: 'c' },
				{ firstRelationId: 'b', secondRelationId: 'c' },
			],
		});
		expect(
			allPairs.alternatives.map(({ respectsRequiredSeparations }) => respectsRequiredSeparations),
		).toEqual([false, false, false, false, true]);
		expect(allPairs.alternatives[4]?.metricDemand).toEqual({
			minimumCrossSize: 144,
			growth: 64,
		});
	});

	it('normalizes incidence and separation permutations before building the contract', () => {
		const baseline = threeIncidenceFaceCapacity({
			...face,
			requiredSeparations: [{ firstRelationId: 'a', secondRelationId: 'b' }],
		});
		const permuted = threeIncidenceFaceCapacity({
			...face,
			incidences: [...face.incidences].reverse(),
			requiredSeparations: [
				{ firstRelationId: 'b', secondRelationId: 'a' },
				{ firstRelationId: 'a', secondRelationId: 'b' },
			],
		});
		expect(permuted).toEqual(baseline);
	});

	it('rejects invalid arity, identity, measurements and separation references', () => {
		expect(() =>
			threeIncidenceFaceCapacity({ ...face, incidences: face.incidences.slice(0, 2) }),
		).toThrow(/exactly three/);
		expect(() =>
			threeIncidenceFaceCapacity({
				...face,
				incidences: [face.incidences[0], face.incidences[0], face.incidences[2]].filter(
					(incidence) => incidence !== undefined,
				),
			}),
		).toThrow(/unique/);
		expect(() => threeIncidenceFaceCapacity({ ...face, spacing: 0 })).toThrow(/Face measurements/);
		expect(() =>
			threeIncidenceFaceCapacity({
				...face,
				requiredSeparations: [{ firstRelationId: 'a', secondRelationId: 'missing' }],
			}),
		).toThrow(/two distinct face incidences/);
	});
});

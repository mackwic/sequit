import { describe, expect, it } from 'vitest';

import {
	type FaceCapacityInput,
	threeIncidenceFaceCapacity,
} from '../../../../src/app/workshop/solver-prototype/face-capacity';

function incomingTo(target: 'd' | 'e'): FaceCapacityInput {
	return {
		endpointId: target,
		role: 'incoming',
		incidences: ['a', 'b', 'c'].map((source) => ({
			relationId: `${source}-${target}`,
			oppositeEndpointId: source,
		})),
		intrinsicCrossSize: 80,
		inset: 24,
		spacing: 48,
	};
}

describe('symbolic face-capacity witness', () => {
	it('keeps all five partitions and makes the 144-unit demand conditional on three ports', () => {
		for (const target of ['d', 'e'] as const) {
			const contract = threeIncidenceFaceCapacity(incomingTo(target));
			expect(contract.alternatives).toHaveLength(5);
			expect(
				contract.alternatives.every(
					({ respectsRequiredSeparations }) => respectsRequiredSeparations,
				),
			).toBe(true);
			expect(
				contract.alternatives.map(({ metricDemand }) => metricDemand.minimumCrossSize),
			).toEqual([80, 96, 96, 96, 144]);
			expect(contract.alternatives[0]?.metricDemand.growth).toBe(0);
			expect(contract.alternatives[4]?.metricDemand.growth).toBe(64);
		}
	});

	it('can exclude sharing when an independent routing constraint requires separation', () => {
		const input = incomingTo('d');
		const ids = input.incidences.map(({ relationId }) => relationId);
		const [a, b, c] = ids;
		if (a === undefined || b === undefined || c === undefined)
			throw new Error('Missing fixture ID.');
		const contract = threeIncidenceFaceCapacity({
			...input,
			requiredSeparations: [
				{ firstRelationId: a, secondRelationId: b },
				{ firstRelationId: a, secondRelationId: c },
				{ firstRelationId: b, secondRelationId: c },
			],
		});
		expect(
			contract.alternatives.filter(
				({ respectsRequiredSeparations }) => respectsRequiredSeparations,
			),
		).toEqual([contract.alternatives[4]]);
		expect(contract.alternatives[4]?.metricDemand.minimumCrossSize).toBe(144);
	});

	it('normalizes incidence and separation order before enumerating alternatives', () => {
		const input = incomingTo('d');
		const [a, b] = input.incidences.map(({ relationId }) => relationId);
		if (a === undefined || b === undefined) throw new Error('Missing fixture ID.');
		const separation = { firstRelationId: a, secondRelationId: b };
		const original = threeIncidenceFaceCapacity({ ...input, requiredSeparations: [separation] });
		const permuted = threeIncidenceFaceCapacity({
			...input,
			incidences: input.incidences.toReversed(),
			requiredSeparations: [{ firstRelationId: b, secondRelationId: a }, separation],
		});
		expect(permuted).toEqual(original);
	});

	it('preserves an already wide face and accepts zero inset at the boundary', () => {
		const wide = threeIncidenceFaceCapacity({ ...incomingTo('d'), intrinsicCrossSize: 200 });
		expect(wide.alternatives.every(({ metricDemand }) => metricDemand.growth === 0)).toBe(true);
		expect(
			wide.alternatives.every(({ metricDemand }) => metricDemand.minimumCrossSize === 200),
		).toBe(true);

		const flush = threeIncidenceFaceCapacity({ ...incomingTo('d'), inset: 0 });
		expect(flush.alternatives.at(-1)?.metricDemand).toEqual({
			minimumCrossSize: 96,
			growth: 16,
		});
	});

	it('rejects malformed incidence identity and arity before producing alternatives', () => {
		const input = incomingTo('d');
		expect(() =>
			threeIncidenceFaceCapacity({ ...input, incidences: input.incidences.slice(0, 2) }),
		).toThrow(/exactly three/);
		expect(() =>
			threeIncidenceFaceCapacity({
				...input,
				incidences: [input.incidences[0], input.incidences[0], input.incidences[2]].filter(
					(incidence) => incidence !== undefined,
				),
			}),
		).toThrow(/unique/);
	});

	it.each([
		{ name: 'non-finite intrinsic size', values: { intrinsicCrossSize: Number.POSITIVE_INFINITY } },
		{ name: 'zero intrinsic size', values: { intrinsicCrossSize: 0 } },
		{ name: 'non-finite inset', values: { inset: Number.NaN } },
		{ name: 'negative inset', values: { inset: -1 } },
		{ name: 'non-finite spacing', values: { spacing: Number.POSITIVE_INFINITY } },
		{ name: 'zero spacing', values: { spacing: 0 } },
	])('rejects $name', ({ values }) => {
		expect(() => threeIncidenceFaceCapacity({ ...incomingTo('d'), ...values })).toThrow(
			/Face measurements/,
		);
	});

	it('rejects separations that refer to the same or an absent incidence', () => {
		const input = incomingTo('d');
		const first = input.incidences[0]?.relationId;
		const second = input.incidences[1]?.relationId;
		if (first === undefined || second === undefined) throw new Error('Missing fixture ID.');
		for (const requiredSeparations of [
			[{ firstRelationId: first, secondRelationId: first }],
			[{ firstRelationId: 'unknown', secondRelationId: second }],
			[{ firstRelationId: first, secondRelationId: 'unknown' }],
		]) {
			expect(() => threeIncidenceFaceCapacity({ ...input, requiredSeparations })).toThrow(
				/two distinct face incidences/,
			);
		}
	});

	it('keeps mixed sharing when only one pair has a routing conflict', () => {
		const input = incomingTo('d');
		const first = input.incidences[0]?.relationId;
		const second = input.incidences[1]?.relationId;
		if (first === undefined || second === undefined) throw new Error('Missing fixture ID.');
		const contract = threeIncidenceFaceCapacity({
			...input,
			requiredSeparations: [{ firstRelationId: first, secondRelationId: second }],
		});
		const allowed = contract.alternatives.filter(
			({ respectsRequiredSeparations }) => respectsRequiredSeparations,
		);
		expect(allowed).toHaveLength(3);
		expect(allowed.some(({ portGroups }) => portGroups.length === 2)).toBe(true);
		expect(allowed.some(({ portGroups }) => portGroups.length === 3)).toBe(true);
	});
});

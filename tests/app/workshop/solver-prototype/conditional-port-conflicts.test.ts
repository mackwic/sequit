import { describe, expect, it } from 'vitest';

import {
	type ConditionalPortConflictInput,
	conditionalPortConflicts,
} from '../../../../src/app/workshop/solver-prototype/conditional-port-conflicts';
import { threeIncidenceFaceCapacity } from '../../../../src/app/workshop/solver-prototype/face-capacity';

function completeBipartite(): ConditionalPortConflictInput {
	return {
		sourceRank: 1,
		targetRank: 0,
		sourceOrder: ['a', 'b', 'c'],
		targetOrder: ['d', 'e'],
		relations: ['a', 'b', 'c'].flatMap((from) =>
			['d', 'e'].map((to) => ({ id: `${from}-${to}`, from, to })),
		),
		passage: 'monotone-adjacent-corridor',
	};
}

describe('conditional port conflicts', () => {
	it('derives all six incoming separations from three strict K3,2 order inversions', () => {
		const result = conditionalPortConflicts(completeBipartite());
		expect(result.status).toBe('deduced');
		expect(result.inversions).toEqual([
			{ firstRelationId: 'a-e', secondRelationId: 'b-d' },
			{ firstRelationId: 'a-e', secondRelationId: 'c-d' },
			{ firstRelationId: 'b-e', secondRelationId: 'c-d' },
		]);
		expect(result.forcedCrossed).toEqual(['a-e', 'b-d', 'b-e', 'c-d']);
		expect(result.requiredSeparations).toEqual([
			{ endpointId: 'd', firstRelationId: 'a-d', secondRelationId: 'b-d' },
			{ endpointId: 'd', firstRelationId: 'a-d', secondRelationId: 'c-d' },
			{ endpointId: 'd', firstRelationId: 'b-d', secondRelationId: 'c-d' },
			{ endpointId: 'e', firstRelationId: 'a-e', secondRelationId: 'b-e' },
			{ endpointId: 'e', firstRelationId: 'a-e', secondRelationId: 'c-e' },
			{ endpointId: 'e', firstRelationId: 'b-e', secondRelationId: 'c-e' },
		]);
	});

	it('recomputes crossed incidences when the target order reverses', () => {
		const fixture = completeBipartite();
		const result = conditionalPortConflicts({
			...fixture,
			targetOrder: ['e', 'd'],
		});
		expect(result.inversions).toEqual([
			{ firstRelationId: 'a-d', secondRelationId: 'b-e' },
			{ firstRelationId: 'a-d', secondRelationId: 'c-e' },
			{ firstRelationId: 'b-d', secondRelationId: 'c-e' },
		]);
		expect(result.forcedCrossed).toEqual(['a-d', 'b-d', 'b-e', 'c-e']);
		expect(result.requiredSeparations).toHaveLength(6);
	});

	it('feeds the face contract from derived conflicts, leaving only the 144-unit alternative', () => {
		const fixture = completeBipartite();
		const conflicts = conditionalPortConflicts(fixture);
		expect(conflicts.status).toBe('deduced');
		for (const endpointId of fixture.targetOrder) {
			const contract = threeIncidenceFaceCapacity({
				endpointId,
				role: 'incoming',
				incidences: fixture.relations
					.filter(({ to }) => to === endpointId)
					.map(({ id, from }) => ({ relationId: id, oppositeEndpointId: from })),
				intrinsicCrossSize: 80,
				inset: 24,
				spacing: 48,
				requiredSeparations: conflicts.requiredSeparations
					.filter((separation) => separation.endpointId === endpointId)
					.map(({ firstRelationId, secondRelationId }) => ({ firstRelationId, secondRelationId })),
			});
			const allowed = contract.alternatives.filter(
				({ respectsRequiredSeparations }) => respectsRequiredSeparations,
			);
			expect(allowed).toHaveLength(1);
			expect(allowed[0]?.portGroups).toHaveLength(3);
			expect(allowed[0]?.metricDemand.minimumCrossSize).toBe(144);
		}
	});

	it('preserves sharing as possible when the ordered relations have no inversion', () => {
		const fixture = completeBipartite();
		const result = conditionalPortConflicts({
			...fixture,
			relations: fixture.relations.filter(({ id }) => ['a-d', 'b-e', 'c-e'].includes(id)),
		});
		expect(result).toEqual({
			status: 'deduced',
			inversions: [],
			forcedCrossed: [],
			requiredSeparations: [],
		});
	});

	it('separates only arrivals involving a forced crossing in a partial corridor', () => {
		const fixture = completeBipartite();
		const result = conditionalPortConflicts({
			...fixture,
			relations: fixture.relations.filter(({ id }) => ['a-d', 'b-d', 'b-e', 'c-d'].includes(id)),
		});
		expect(result.inversions).toEqual([{ firstRelationId: 'b-e', secondRelationId: 'c-d' }]);
		expect(result.forcedCrossed).toEqual(['b-e', 'c-d']);
		expect(result.requiredSeparations).toEqual([
			{ endpointId: 'd', firstRelationId: 'a-d', secondRelationId: 'c-d' },
			{ endpointId: 'd', firstRelationId: 'b-d', secondRelationId: 'c-d' },
		]);
	});

	it('normalizes relation collection order without changing candidate row order', () => {
		const fixture = completeBipartite();
		expect(
			conditionalPortConflicts({
				...fixture,
				relations: fixture.relations.toReversed(),
			}),
		).toEqual(conditionalPortConflicts(fixture));
	});

	it('leaves outside and non-adjacent passages unknown rather than asserting port reuse', () => {
		const fixture = completeBipartite();
		const outside = conditionalPortConflicts({
			...fixture,
			passage: 'other-passage',
		});
		expect(outside).toEqual({
			status: 'unknown',
			reason: 'other-passage',
			inversions: [],
			forcedCrossed: [],
			requiredSeparations: [],
		});
		expect(conditionalPortConflicts({ ...fixture, sourceRank: 2 })).toEqual({
			status: 'unknown',
			reason: 'non-adjacent-ranks',
			inversions: [],
			forcedCrossed: [],
			requiredSeparations: [],
		});
	});

	it('rejects duplicate IDs and relations outside the ordered rows', () => {
		const fixture = completeBipartite();
		expect(() => conditionalPortConflicts({ ...fixture, sourceOrder: ['a', 'a', 'c'] })).toThrow(
			/Duplicate source endpoint/,
		);
		expect(() => conditionalPortConflicts({ ...fixture, targetOrder: ['d', 'd'] })).toThrow(
			/Duplicate target endpoint/,
		);
		expect(() => conditionalPortConflicts({ ...fixture, targetOrder: ['d', 'a'] })).toThrow(
			/distinct endpoints/,
		);
		expect(() =>
			conditionalPortConflicts({
				...fixture,
				relations: [...fixture.relations, fixture.relations[0]].filter(
					(relation) => relation !== undefined,
				),
			}),
		).toThrow(/Duplicate relation/);
		expect(() =>
			conditionalPortConflicts({
				...fixture,
				relations: [...fixture.relations, { id: 'outside', from: 'x', to: 'd' }],
			}),
		).toThrow(/outside the ordered corridor/);
		expect(() =>
			conditionalPortConflicts({
				...fixture,
				relations: [...fixture.relations, { id: 'outside', from: 'a', to: 'x' }],
			}),
		).toThrow(/outside the ordered corridor/);
	});

	it('rejects fractional and negative ranks before reporting passage status', () => {
		const fixture = completeBipartite();
		expect(() => conditionalPortConflicts({ ...fixture, sourceRank: -1 })).toThrow(
			/non-negative integers/,
		);
		expect(() => conditionalPortConflicts({ ...fixture, targetRank: 0.5 })).toThrow(
			/non-negative integers/,
		);
	});
});

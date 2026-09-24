import { describe, expect, it } from 'vitest';

import {
	type ConditionalPortConflictInput,
	conditionalPortConflicts,
} from '../../../../src/lib/core/layout/routing/conditional-port-conflicts';

const sparseWitness: ConditionalPortConflictInput = {
	sourceRank: 1,
	targetRank: 0,
	sourceOrder: ['a', 'b', 'c'],
	targetOrder: ['d', 'e'],
	relations: [
		{ id: 'a-d', from: 'a', to: 'd' },
		{ id: 'b-d', from: 'b', to: 'd' },
		{ id: 'c-d', from: 'c', to: 'd' },
		{ id: 'a-e', from: 'a', to: 'e' },
	],
	passage: 'monotone-adjacent-corridor',
};

describe('conditional port conflicts for an ordered corridor', () => {
	it('recomputes crossed arrivals and target separations for each candidate order', () => {
		const first = conditionalPortConflicts(sparseWitness);
		expect(first).toEqual({
			status: 'deduced',
			inversions: [
				{ firstRelationId: 'a-e', secondRelationId: 'b-d' },
				{ firstRelationId: 'a-e', secondRelationId: 'c-d' },
			],
			forcedCrossed: ['a-e', 'b-d', 'c-d'],
			requiredSeparations: [
				{ endpointId: 'd', firstRelationId: 'a-d', secondRelationId: 'b-d' },
				{ endpointId: 'd', firstRelationId: 'a-d', secondRelationId: 'c-d' },
				{ endpointId: 'd', firstRelationId: 'b-d', secondRelationId: 'c-d' },
			],
		});
		expect(conditionalPortConflicts({ ...sparseWitness, targetOrder: ['e', 'd'] })).toEqual({
			status: 'deduced',
			inversions: [],
			forcedCrossed: [],
			requiredSeparations: [],
		});
	});

	it('leaves alternate passages unknown instead of approving port sharing', () => {
		expect(conditionalPortConflicts({ ...sparseWitness, passage: 'other-passage' })).toEqual({
			status: 'unknown',
			reason: 'other-passage',
			inversions: [],
			forcedCrossed: [],
			requiredSeparations: [],
		});
	});

	it('normalizes relation collection permutations without changing candidate row order', () => {
		expect(
			conditionalPortConflicts({
				...sparseWitness,
				relations: [...sparseWitness.relations].reverse(),
			}),
		).toEqual(conditionalPortConflicts(sparseWitness));
	});
});

import { describe, expect, it } from 'vitest';

import { runFoldedGroupWitness } from '../../../../../src/app/workshop/visual-tests/solver-prototype/folded-group';

describe('folded group solver witness', () => {
	it('shows the source layout and the rejected visible projection with provenance', async () => {
		const witness = await runFoldedGroupWitness();
		expect(witness.expanded.elements.map(({ id }) => id)).toEqual(
			expect.arrayContaining(['A', 'B', 'G', 'x']),
		);
		expect(witness.projectedRelations).toEqual([
			{ id: 'B-to-x', from: 'G', to: 'x', sourceRelationIds: ['B-to-x'] },
			{ id: 'x-to-A', from: 'x', to: 'G', sourceRelationIds: ['x-to-A'] },
		]);
		expect(witness.hiddenEndpointIds).toEqual(['A', 'B']);
		expect(witness.normalized.relations).toEqual([
			{
				id: 'B-to-x',
				from: { endpointId: 'B', visibleOwnerId: 'G' },
				to: { endpointId: 'x', visibleOwnerId: 'x' },
			},
			{
				id: 'x-to-A',
				from: { endpointId: 'x', visibleOwnerId: 'x' },
				to: { endpointId: 'A', visibleOwnerId: 'G' },
			},
		]);
		expect(witness.diagnostic).toContain('Cycle detected');
	});
});

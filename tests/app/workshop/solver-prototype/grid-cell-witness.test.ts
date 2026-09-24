import { describe, expect, it } from 'vitest';

import { runGridCellWitness } from '../../../../src/app/workshop/visual-tests/solver-prototype/grid-cell-witness';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grid-cell-types';

describe('observable grid-cell witness', () => {
	it('materializes four local cells and validates its rank four to one crossing', () => {
		const witness = runGridCellWitness();
		expect(witness.attempt.status).toBe(GridCellLayoutStatus.Selected);
		if (witness.attempt.status !== GridCellLayoutStatus.Selected) return;
		expect(witness.validation).toBeUndefined();
		expect(witness.attempt.cells).toHaveLength(4);
		expect(witness.localRanks.get('source4')).toBe(4);
		expect(witness.localRanks.get('target1')).toBe(1);
		expect(witness.attempt.portals).toHaveLength(2);
		expect(witness.attempt.layout.relations.find(({ id }) => id === 'across-grid')).toBeDefined();
	});
});

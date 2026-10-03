import { describe, expect, it } from 'vitest';

import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { RelationPortOffsets } from '../../../../src/lib/core/layout/routing/relation-port-offsets';
import { validLogicDocument } from '../../../support/builders/logic-document';

function graph() {
	const created = createGraph(validLogicDocument());
	if (!created.ok) throw new Error('The valid document must form a graph.');
	return created.value;
}

describe('relation port offsets', () => {
	it.each([
		['an indexed read', (offsets: RelationPortOffsets) => offsets.at(0)],
		['a read by id', (offsets: RelationPortOffsets) => offsets.get('a-to-choice')],
		['an iteration', (offsets: RelationPortOffsets) => [...offsets]],
	])('refuses an assignment after %s instead of serving stale offsets', (_name, read) => {
		const logic = graph();
		const [first, second] = logic.relations.map(({ relation }) => relation.id);
		const offsets = new RelationPortOffsets(logic);
		offsets.assign(0, 12);
		offsets.assign(1, -12);
		read(offsets);
		expect(() => {
			offsets.assign(2, 24);
		}).toThrow(/read-only/);
		expect([...offsets]).toEqual([
			[first, 12],
			[second, -12],
		]);
		expect(offsets.at(2)).toBeUndefined();
	});
});

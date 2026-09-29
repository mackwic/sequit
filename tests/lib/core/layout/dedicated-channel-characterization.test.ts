import { describe, expect, it } from 'vitest';

import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import {
	junctionNetworkDocument,
	multirankOne,
	multirankTwo,
	railReuseDocument,
} from '../../../support/scenarios/dedicated-channel-witnesses';
import { referenceRouteBridgeAnalysis } from './bridge-oracle-reference';

function visibleRoutes(document: LogicDocument) {
	const created = createGraph(document);
	if (!created.ok) throw new Error(`Invalid channel witness ${document.id}`);
	const layout = layoutWithDedicatedEngine(
		created.value,
		topologicallyRank(created.value),
		layoutMeasurementsFor(document),
	);
	return new Map(layout.relations.map((relation) => [relation.id, relation.points]));
}

describe('observable dedicated channel routes', () => {
	it('reuses a visible rail for separated routes and keeps parallel junction relations distinct', () => {
		const routes = visibleRoutes(railReuseDocument());
		const first = routes.get('c-to-e');
		const second = routes.get('d-to-e');
		if (first === undefined || second === undefined) throw new Error('Expected rail reuse routes');
		expect(first[3]?.y).toBe(second[3]?.y);
		expect(first[3]?.x).not.toBe(second[3]?.x);
		const junctions = visibleRoutes(junctionNetworkDocument('junction-network'));
		expect(junctions.get('j-to-d-one')).not.toEqual(junctions.get('j-to-d-two'));
	});

	it.each([
		[multirankOne, ['a-to-d', 'b-to-c']],
		[multirankTwo, ['c-to-f', 'd-to-e']],
	] as const)('avoids the formerly crossed pair in %s', (document, pair) => {
		const routes = visibleRoutes(document);
		const paths = pair.map((id) => ({ id, points: routes.get(id) ?? [] }));
		expect(paths.every(({ points }) => points.length > 1)).toBe(true);
		expect(referenceRouteBridgeAnalysis(paths).crossings).toEqual([]);
	});
});

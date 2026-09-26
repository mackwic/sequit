import { describe, expect, it } from 'vitest';

import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import {
	junctionNetworkDocument,
	multirankOne,
	multirankTwo,
	railClearanceDocument,
	railClearanceMeasurements,
	railReuseDocument,
} from '../../../support/scenarios/dedicated-channel-witnesses';
import { referenceRouteBridgeAnalysis } from './bridge-oracle-reference';

function visibleRoutes(
	document: ReturnType<typeof railReuseDocument>,
	overrides?: ReturnType<typeof railClearanceMeasurements>,
) {
	const created = createGraph(document);
	if (!created.ok) throw new Error(`Invalid channel witness ${document.id}`);
	const layout = layoutWithDedicatedEngine(
		created.value,
		topologicallyRank(created.value),
		layoutMeasurementsFor(document, overrides),
	);
	return new Map(layout.relations.map((relation) => [relation.id, relation.points]));
}

function horizontalTransitY(routes: ReturnType<typeof visibleRoutes>, id: string): number {
	const points = routes.get(id);
	if (points?.[1] === undefined || points[2] === undefined)
		throw new Error(`Missing visible horizontal transit for ${id}`);
	if (points[1].y !== points[2].y) throw new Error(`Route ${id} has no horizontal transit`);
	return points[1].y;
}

describe('observable dedicated channel routes', () => {
	it('separates visible transits at the clearance boundary and reuses one beyond it', () => {
		const document = railClearanceDocument();
		const touching = visibleRoutes(document, railClearanceMeasurements(12));
		const clear = visibleRoutes(document, railClearanceMeasurements(13));
		expect(horizontalTransitY(touching, 'a-to-d')).not.toBe(horizontalTransitY(touching, 'a-to-e'));
		expect(horizontalTransitY(clear, 'a-to-d')).toBe(horizontalTransitY(clear, 'a-to-e'));
	});

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

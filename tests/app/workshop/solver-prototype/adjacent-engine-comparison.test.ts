import { describe, expect, it } from 'vitest';

import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import { compareAdjacentBridgeAndDetour } from '../../../../src/app/workshop/solver-prototype/adjacent-engine-comparison';
import { realK32Fixture } from '../../../../src/app/workshop/solver-prototype/real-k32-witness';
import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { routeCrossings } from '../../../support/assertions/route-geometry';

describe('adjacent 3+1 bridge and detour comparison', () => {
	it('uses one document and intrinsic measurement set for two geometrically distinct valid results', async () => {
		const comparison = await compareAdjacentBridgeAndDetour();
		const fixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
		expect(comparison.document).toEqual(fixture.document);
		expect(comparison.measurements).toEqual(fixture.measurements);
		expect(comparison.document.relations.map(({ id }) => id).sort()).toEqual([
			'a-to-d',
			'a-to-e',
			'b-to-d',
			'c-to-d',
		]);
		const created = createGraph(comparison.document);
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		expect(comparison.ranks).toEqual(topologicallyRank(created.value).byEndpointId);
		expect(comparison.dedicated.validation).toBe('valid');
		expect(comparison.independent.validation).toBe('valid');
		expect(comparison.independent.globalStatus).toBe('undetermined');
		expect(comparison.dedicated.targetOrder).toBe('d < e');
		expect(comparison.independent.targetOrder).toBe('e < d');
		for (const result of [comparison.dedicated, comparison.independent]) {
			expect(result.layout.elements.map(({ id }) => id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
			expect(result.layout.relations.map(({ id }) => id).sort()).toEqual(
				comparison.document.relations.map(({ id }) => id).sort(),
			);
			expect(result.metrics.area).toBe(result.layout.width * result.layout.height);
			expect(result.layout.width).toBeLessThanOrEqual(comparison.frame.width);
			expect(result.layout.height).toBeLessThanOrEqual(comparison.frame.height);
		}
	});

	it('renders actual canvas bridge arcs only for the dedicated strict crossings', async () => {
		const comparison = await compareAdjacentBridgeAndDetour();
		const dedicatedCrossings = routeCrossings(comparison.dedicated.layout.relations);
		const independentCrossings = routeCrossings(comparison.independent.layout.relations);
		expect(dedicatedCrossings.length).toBeGreaterThan(0);
		expect(independentCrossings).toEqual([]);
		expect(comparison.dedicated.metrics.crossings).toBe(dedicatedCrossings.length);
		expect(comparison.independent.metrics.crossings).toBe(0);
		for (const result of [comparison.dedicated, comparison.independent]) {
			const actualArcs = renderRelationPaths(result.layout.relations).reduce(
				(count, relation) => count + (relation.path.match(/\bA /g)?.length ?? 0),
				0,
			);
			expect(result.metrics.bridges).toBe(actualArcs);
		}
		expect(comparison.dedicated.metrics.bridges).toBeGreaterThan(0);
		expect(comparison.dedicated.metrics.bridges).toBe(dedicatedCrossings.length);
		expect(comparison.independent.metrics.bridges).toBe(0);
		expect(comparison.dedicated.metrics.routeLength).toBeGreaterThan(0);
		expect(comparison.independent.metrics.routeLength).toBeGreaterThan(0);
	});
});

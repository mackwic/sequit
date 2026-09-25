import { describe, expect, it } from 'vitest';

import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import { compareAdjacentBridgeAndDetour } from '../../../../src/app/workshop/solver-prototype/adjacent-engine-comparison';
import { realK32Fixture } from '../../../../src/app/workshop/solver-prototype/real-k32-witness';
import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { validatedBridges } from '../../../../src/lib/core/layout/bridge-oracle';
import {
	DETOUR_AREA_TOLERANCE,
	DETOUR_LENGTH_TOLERANCE,
	IndependentAdjacentIssue,
	IndependentAdjacentStatus,
	resolveIndependentAdjacentContract,
} from '../../../../src/lib/core/layout/contract/independent-adjacent-resolution';
import { routeCrossings } from '../../../support/assertions/route-geometry';

describe('adjacent 3+1 bridge and detour comparison', () => {
	it('compares the real graph on shared measurements and reports both issue costs', async () => {
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
		expect(comparison.independent.selectedIssue).toBe(IndependentAdjacentIssue.Bridge);
		expect(comparison.independent.comparison).toMatchObject({
			selected: IndependentAdjacentIssue.Bridge,
		});
		const costs = comparison.independent.comparison;
		if (costs === undefined) throw new Error('Expected both adjacent issue costs');
		expect(costs.detour.area / costs.bridge.area - 1).toBeGreaterThan(DETOUR_AREA_TOLERANCE);
		expect(costs.detour.routeLength / costs.bridge.routeLength - 1).toBeGreaterThan(
			DETOUR_LENGTH_TOLERANCE,
		);
		expect(comparison.independent.metrics.area).toBe(costs.bridge.area);
		expect(comparison.independent.metrics.routeLength).toBe(costs.bridge.routeLength);
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

	it('retains the real detour when both measured costs stay within their tolerances', () => {
		const fixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
		const created = createGraph(fixture.document);
		if (!created.ok) throw new Error('Expected the real 3+1 fixture graph');
		const ranks = topologicallyRank(created.value);
		const measurements = {
			...fixture.measurements,
			nodes: new Map(
				[...fixture.measurements.nodes.keys()].map((id) => [id, { width: 1000, height: 1000 }]),
			),
		};
		const resolution = resolveIndependentAdjacentContract(created.value, ranks, measurements);
		expect(resolution.status).toBe(IndependentAdjacentStatus.Selected);
		if (resolution.status !== IndependentAdjacentStatus.Selected) return;
		const costs = resolution.comparison;
		if (costs === undefined) throw new Error('Expected both measured issue costs');
		expect(costs.selected).toBe(IndependentAdjacentIssue.Detour);
		expect(costs.detour.area / costs.bridge.area - 1).toBeLessThanOrEqual(DETOUR_AREA_TOLERANCE);
		expect(costs.detour.routeLength / costs.bridge.routeLength - 1).toBeLessThanOrEqual(
			DETOUR_LENGTH_TOLERANCE,
		);
		expect(resolution.selection.bridged).toBe(false);
		expect(validatedBridges(resolution.selection.layout.relations)).toEqual([]);
	});

	it('renders each validated strict crossing as an actual canvas bridge arc', async () => {
		const comparison = await compareAdjacentBridgeAndDetour();
		for (const result of [comparison.dedicated, comparison.independent]) {
			const crossings = routeCrossings(result.layout.relations);
			const bridges = validatedBridges(result.layout.relations);
			const renderedArcs = renderRelationPaths(result.layout.relations).reduce(
				(count, relation) => count + (relation.path.match(/\bA /g)?.length ?? 0),
				0,
			);
			expect(crossings.length).toBeGreaterThan(0);
			expect(bridges).toHaveLength(crossings.length);
			expect(renderedArcs).toBe(bridges.length);
			expect(result.metrics.crossings).toBe(crossings.length);
			expect(result.metrics.bridges).toBe(renderedArcs);
			expect(result.metrics.routeLength).toBeGreaterThan(0);
		}
	});
});

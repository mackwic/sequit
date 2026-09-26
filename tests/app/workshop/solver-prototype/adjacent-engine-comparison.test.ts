import { describe, expect, it } from 'vitest';

import { renderRelationPaths } from '../../../../src/app/web/ui/canvas/render-relations';
import { compareAdjacentBridgeAndDetour } from '../../../../src/app/workshop/solver-prototype/adjacent-engine-comparison';
import {
	requireDemoGraph,
	requireSelectedDemoResult,
} from '../../../../src/app/workshop/solver-prototype/demo-result';
import { realK32Fixture } from '../../../../src/app/workshop/solver-prototype/real-k32-witness';
import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { validatedBridges } from '../../../../src/lib/core/layout/bridge-oracle';
import { candidateFaceBranches } from '../../../../src/lib/core/layout/contract/candidate-face-branches';
import {
	materializeIndependentAdjacentBridgeGeometry,
	materializeIndependentAdjacentGeometry,
} from '../../../../src/lib/core/layout/contract/independent-adjacent-geometry';
import {
	DETOUR_AREA_TOLERANCE,
	DETOUR_LENGTH_TOLERANCE,
	IndependentAdjacentIssue,
	IndependentAdjacentStatus,
	resolveIndependentAdjacentContract,
} from '../../../../src/lib/core/layout/contract/independent-adjacent-resolution';
import {
	buildAdjacentLayoutContract,
	LayoutContractBuildStatus,
} from '../../../../src/lib/core/layout/contract/layout-contract';
import type {
	LayoutMeasurements,
	LayoutResult,
} from '../../../../src/lib/core/layout/layout-types';
import { layoutRouteCost } from '../../../../src/lib/core/layout/routing/route-cost';
import { routeCrossings } from '../../../support/assertions/route-geometry';

function materializeReportedBranch(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	branchId: string,
): LayoutResult {
	const bridge = branchId.endsWith(':bridge');
	let candidateBranchId = branchId;
	if (bridge) candidateBranchId = branchId.slice(0, -':bridge'.length);
	const built = buildAdjacentLayoutContract(graph, topologicallyRank(graph), measurements);
	if (built.status !== LayoutContractBuildStatus.Ready)
		throw new Error('Expected an adjacent contract for the reported branch');
	const branch = built.contract.candidates
		.flatMap(candidateFaceBranches)
		.find((candidate) => candidate.id === candidateBranchId);
	if (branch === undefined) throw new Error(`Unknown reported branch ${branchId}`);
	let layout: LayoutResult | undefined;
	if (bridge)
		layout = materializeIndependentAdjacentBridgeGeometry(
			graph,
			measurements,
			branch.candidate,
			branch.choices,
		);
	else
		layout = materializeIndependentAdjacentGeometry(
			graph,
			measurements,
			branch.candidate,
			branch.choices,
		);
	if (layout === undefined) throw new Error(`Could not materialize reported branch ${branchId}`);
	return layout;
}

function allocatedGrowth(layout: LayoutResult, measurements: LayoutMeasurements): number {
	return layout.elements.reduce((total, element) => {
		const measured = measurements.nodes.get(element.id);
		if (measured === undefined) throw new Error(`Missing measurement for ${element.id}`);
		return (
			total +
			Math.max(0, element.bounds.width - measured.width) +
			Math.max(0, element.bounds.height - measured.height)
		);
	}, 0);
}

describe('adjacent 3+1 bridge and detour comparison', () => {
	it('reports malformed graph and unsupported resolution states through shared guards', () => {
		const fixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
		const malformed = {
			...fixture.document,
			relations: [...fixture.document.relations, { id: 'a-to-d', from: 'a', to: 'd' }],
		};
		expect(() => requireDemoGraph(malformed, 'Invalid adjacent witness')).toThrow(
			'Invalid adjacent witness could not be created: Duplicate relation id: a-to-d',
		);

		const completeFixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'complete');
		const completeGraph = requireDemoGraph(completeFixture.document, 'Complete adjacent witness');
		const resolution = resolveIndependentAdjacentContract(
			completeGraph,
			topologicallyRank(completeGraph),
			completeFixture.measurements,
		);
		expect(resolution.status).toBe(IndependentAdjacentStatus.Unknown);
		expect(() => {
			requireSelectedDemoResult(
				resolution,
				IndependentAdjacentStatus.Selected,
				'Independent adjacent witness',
			);
		}).toThrow('Independent adjacent witness is unknown.');
	});
	it('classifies a real measured K32 detour', async () => {
		const fixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
		const measurements = {
			...fixture.measurements,
			nodes: new Map(
				[...fixture.measurements.nodes.keys()].map((id) => [id, { width: 1000, height: 1000 }]),
			),
		};
		const comparison = await compareAdjacentBridgeAndDetour(
			LayoutDirection.TopToBottom,
			'd-e',
			'sparse',
			measurements,
		);
		expect(comparison.independent.selectedIssue).toBe(IndependentAdjacentIssue.Detour);
	});

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
		const ranks = topologicallyRank(created.value);
		expect(comparison.ranks).toEqual(ranks.byEndpointId);
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
		expect(costs.detour).toEqual({ area: 191296, routeLength: 1236, bends: 6 });
		expect(costs.bridge).toEqual({ area: 120768, routeLength: 732, bends: 8 });
		expect(costs.detourTotalGrowth).toBe(16);
		expect(costs.bridgeTotalGrowth).toBe(16);
		expect(costs.detourDifferentialGrowth).toBe(0);
		expect(costs.bridgeDifferentialGrowth).toBe(0);
		expect(costs.policy).toEqual({
			detourAreaTolerance: DETOUR_AREA_TOLERANCE,
			detourLengthTolerance: DETOUR_LENGTH_TOLERANCE,
		});
		const detourLayout = materializeReportedBranch(
			created.value,
			fixture.measurements,
			costs.detourBranchId,
		);
		const bridgeLayout = materializeReportedBranch(
			created.value,
			fixture.measurements,
			costs.bridgeBranchId,
		);
		expect(layoutRouteCost(detourLayout)).toEqual(costs.detour);
		expect(layoutRouteCost(bridgeLayout)).toEqual(costs.bridge);
		expect(allocatedGrowth(detourLayout, fixture.measurements)).toBe(costs.detourTotalGrowth);
		expect(fixture.measurements.nodes.get('a')?.width).toBe(80);
		expect(allocatedGrowth(bridgeLayout, fixture.measurements)).toBe(costs.bridgeTotalGrowth);
		expect(detourLayout.elements.find(({ id }) => id === 'a')?.bounds.width).toBe(96);
		expect(bridgeLayout.elements.find(({ id }) => id === 'a')?.bounds.width).toBe(96);
		expect(comparison.independent.metrics.growth).toBe(costs.bridgeTotalGrowth);
		expect(comparison.dedicated.metrics.area).toBe(130560);
		expect(comparison.dedicated.metrics.routeLength).toBe(896);
		expect(comparison.dedicated.metrics.crossings).toBe(2);
		expect(comparison.dedicated.metrics.bridges).toBe(2);
		expect(
			renderRelationPaths(comparison.dedicated.layout.relations).reduce(
				(count, relation) => count + (relation.path.match(/\bA /g)?.length ?? 0),
				0,
			),
		).toBe(2);
		expect(costs.detour.area / costs.bridge.area - 1).toBeGreaterThan(DETOUR_AREA_TOLERANCE);
		expect(costs.detour.routeLength / costs.bridge.routeLength - 1).toBeGreaterThan(
			DETOUR_LENGTH_TOLERANCE,
		);
		expect(comparison.independent.metrics.area).toBe(costs.bridge.area);
		expect(comparison.independent.metrics.routeLength).toBe(costs.bridge.routeLength);
		expect(comparison.twoByTwo.document.id).toBe('adjacent-2+2-bridge-witness');
		expect(comparison.twoByTwo.independent.selectedIssue).toBe(IndependentAdjacentIssue.Bridge);
		const twoByTwoCosts = comparison.twoByTwo.independent.comparison;
		expect(twoByTwoCosts).toMatchObject({
			detourTotalGrowth: 0,
			bridgeTotalGrowth: 0,
			detourDifferentialGrowth: 0,
			bridgeDifferentialGrowth: 0,
			detour: { area: 523136, routeLength: 1032, bends: 4 },
			bridge: { area: 429440, routeLength: 600, bends: 8 },
		});
		const twoByTwoGraph = createGraph(comparison.twoByTwo.document);
		if (!twoByTwoGraph.ok) throw new Error('Expected the 2+2 comparison graph');
		const twoByTwoDetour = materializeReportedBranch(
			twoByTwoGraph.value,
			comparison.twoByTwo.measurements,
			twoByTwoCosts.detourBranchId,
		);
		const twoByTwoBridge = materializeReportedBranch(
			twoByTwoGraph.value,
			comparison.twoByTwo.measurements,
			twoByTwoCosts.bridgeBranchId,
		);
		expect(layoutRouteCost(twoByTwoDetour)).toEqual(twoByTwoCosts.detour);
		expect(layoutRouteCost(twoByTwoBridge)).toEqual(twoByTwoCosts.bridge);
		expect(allocatedGrowth(twoByTwoDetour, comparison.twoByTwo.measurements)).toBe(
			twoByTwoCosts.detourTotalGrowth,
		);
		expect(allocatedGrowth(twoByTwoBridge, comparison.twoByTwo.measurements)).toBe(
			twoByTwoCosts.bridgeTotalGrowth,
		);
		expect(comparison.twoByTwo.independent.metrics.area).toBe(429440);
		expect(comparison.twoByTwo.independent.metrics.routeLength).toBe(600);
		expect(comparison.twoByTwo.independent.metrics.bridges).toBe(1);
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
		const renderedArcs = renderRelationPaths(resolution.selection.layout.relations).reduce(
			(count, relation) => count + (relation.path.match(/\bA /g)?.length ?? 0),
			0,
		);
		expect(renderedArcs).toBe(0);
	});

	it('changes monotonically with policy tolerances on unchanged measured geometry', () => {
		const fixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
		const created = createGraph(fixture.document);
		if (!created.ok) throw new Error('Expected the real 3+1 fixture graph');
		const ranks = topologicallyRank(created.value);
		const resolveWith = (detourAreaTolerance: number, detourLengthTolerance: number) => {
			const result = resolveIndependentAdjacentContract(
				created.value,
				ranks,
				fixture.measurements,
				{
					policy: { detourAreaTolerance, detourLengthTolerance },
				},
			);
			if (result.status !== IndependentAdjacentStatus.Selected || result.comparison === undefined)
				throw new Error('Expected both real measured issue candidates');
			return result.comparison;
		};
		const strictArea = resolveWith(0.5, 1);
		const permissiveArea = resolveWith(0.6, 1);
		const morePermissiveArea = resolveWith(0.7, 1);
		const strictLength = resolveWith(1, 0.6);
		const permissiveLength = resolveWith(1, 0.7);
		const morePermissiveLength = resolveWith(1, 0.8);
		expect([strictArea.selected, permissiveArea.selected, morePermissiveArea.selected]).toEqual([
			IndependentAdjacentIssue.Bridge,
			IndependentAdjacentIssue.Detour,
			IndependentAdjacentIssue.Detour,
		]);
		expect([
			strictLength.selected,
			permissiveLength.selected,
			morePermissiveLength.selected,
		]).toEqual([
			IndependentAdjacentIssue.Bridge,
			IndependentAdjacentIssue.Detour,
			IndependentAdjacentIssue.Detour,
		]);
		for (const measured of [
			permissiveArea,
			morePermissiveArea,
			strictLength,
			permissiveLength,
			morePermissiveLength,
		]) {
			expect(measured.detour).toEqual(strictArea.detour);
			expect(measured.bridge).toEqual(strictArea.bridge);
			expect(measured.detourTotalGrowth).toBe(strictArea.detourTotalGrowth);
			expect(measured.detourDifferentialGrowth).toBe(strictArea.detourDifferentialGrowth);
			expect(measured.bridgeTotalGrowth).toBe(strictArea.bridgeTotalGrowth);
			expect(measured.bridgeDifferentialGrowth).toBe(strictArea.bridgeDifferentialGrowth);
		}
	});

	it('prefers a lower-growth real 2+2 detour before threshold arbitration', () => {
		const fixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
		const document = {
			...fixture.document,
			relations: [
				{ id: 'a-to-d', from: 'a', to: 'd' },
				{ id: 'b-to-d', from: 'b', to: 'd' },
				{ id: 'a-to-e', from: 'a', to: 'e' },
				{ id: 'c-to-e', from: 'c', to: 'e' },
			],
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('Expected the real 2+2 fixture graph');
		const measurements = {
			...fixture.measurements,
			nodes: new Map(
				[...fixture.measurements.nodes.keys()].map((id) => [id, { width: 20, height: 60 }]),
			),
		};
		const resolution = resolveIndependentAdjacentContract(
			created.value,
			topologicallyRank(created.value),
			measurements,
		);
		expect(resolution.status).toBe(IndependentAdjacentStatus.Selected);
		if (resolution.status !== IndependentAdjacentStatus.Selected) return;
		const costs = resolution.comparison;
		if (costs === undefined) throw new Error('Expected both measured 2+2 issue candidates');
		expect(costs.detourTotalGrowth).toBe(188);
		expect(costs.bridgeTotalGrowth).toBe(236);
		expect(costs.detourDifferentialGrowth).toBe(56);
		expect(costs.bridgeDifferentialGrowth).toBe(104);
		expect(costs.detour).toEqual({ area: 191296, routeLength: 1032, bends: 4 });
		expect(costs.bridge).toEqual({ area: 101824, routeLength: 600, bends: 8 });
		expect(costs.detour.area / costs.bridge.area - 1).toBeGreaterThan(DETOUR_AREA_TOLERANCE);
		expect(costs.detour.routeLength / costs.bridge.routeLength - 1).toBeGreaterThan(
			DETOUR_LENGTH_TOLERANCE,
		);
		expect(costs.selected).toBe(IndependentAdjacentIssue.Detour);
		expect(resolution.selection.totalGrowth).toBe(costs.detourTotalGrowth);
		expect(resolution.selection.differentialGrowth).toBe(costs.detourDifferentialGrowth);
		expect(resolution.selection.branchId).toBe(costs.detourBranchId);
		const detourLayout = materializeReportedBranch(
			created.value,
			measurements,
			costs.detourBranchId,
		);
		expect(allocatedGrowth(detourLayout, measurements)).toBe(costs.detourTotalGrowth);
		expect(measurements.nodes.get('a')?.width).toBe(20);
		expect(detourLayout.elements.find(({ id }) => id === 'a')?.bounds.width).toBe(96);
	});

	it('selects a real bridge when only detour route length exceeds its tolerance', () => {
		const fixture = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse');
		const created = createGraph(fixture.document);
		if (!created.ok) throw new Error('Expected the real 3+1 fixture graph');
		const measurements = {
			...fixture.measurements,
			nodes: new Map(
				[...fixture.measurements.nodes.keys()].map((id) => [id, { width: 96, height: 400 }]),
			),
		};
		const resolution = resolveIndependentAdjacentContract(
			created.value,
			topologicallyRank(created.value),
			measurements,
		);
		expect(resolution.status).toBe(IndependentAdjacentStatus.Selected);
		if (resolution.status !== IndependentAdjacentStatus.Selected) return;
		const costs = resolution.comparison;
		if (costs === undefined) throw new Error('Expected both measured issue costs');
		expect(costs.detour.area / costs.bridge.area - 1).toBeLessThanOrEqual(DETOUR_AREA_TOLERANCE);
		expect(costs.detour.routeLength / costs.bridge.routeLength - 1).toBeGreaterThan(
			DETOUR_LENGTH_TOLERANCE,
		);
		expect(costs.selected).toBe(IndependentAdjacentIssue.Bridge);
		expect(resolution.selection.bridged).toBe(true);
		expect(validatedBridges(resolution.selection.layout.relations)).not.toHaveLength(0);
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

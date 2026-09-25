import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import { createGraph, type LogicGraph } from '../../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../../src/lib/core/graph/topological-ranks';
import { unbridgedCrossings } from '../../../../../src/lib/core/layout/bridge-contact';
import {
	routeBridgeAnalysis,
	validatedBridges,
} from '../../../../../src/lib/core/layout/bridge-oracle';
import { candidateFaceBranches } from '../../../../../src/lib/core/layout/contract/candidate-face-branches';
import {
	AdjacentGeometryMode,
	materializeIndependentAdjacentBridgeGeometry,
	materializeIndependentAdjacentGeometry,
} from '../../../../../src/lib/core/layout/contract/independent-adjacent-geometry';
import {
	arbitrateIssue,
	IndependentAdjacentBranchStatus,
	type IndependentAdjacentCostCandidate,
	IndependentAdjacentGlobalStatus,
	IndependentAdjacentStatus,
	resolveIndependentAdjacentContract,
} from '../../../../../src/lib/core/layout/contract/independent-adjacent-resolution';
import {
	buildAdjacentLayoutContract,
	LayoutContractBuildStatus,
} from '../../../../../src/lib/core/layout/contract/layout-contract';
import { satisfyMetricDemands } from '../../../../../src/lib/core/layout/contract/metric-demand';
import {
	CandidateGeometryReason,
	validateContractCandidate,
} from '../../../../../src/lib/core/layout/contract/validate-candidate';
import {
	SourceFaceDemandFailure,
	validateSourceFaceDemands,
} from '../../../../../src/lib/core/layout/contract/validate-source-face-demand';
import { PORT_INSET, PORT_SPACING } from '../../../../../src/lib/core/layout/layout-settings';
import {
	type LayoutMeasurements,
	RoutingPortRole,
} from '../../../../../src/lib/core/layout/layout-types';
import { layoutRouteCost } from '../../../../../src/lib/core/layout/routing/route-cost';
import { routeCrossings } from '../../../../support/assertions/route-geometry';

const nodeIds = ['a', 'b', 'c', 'd', 'e'] as const;
const directions = [
	LayoutDirection.TopToBottom,
	LayoutDirection.BottomToTop,
	LayoutDirection.LeftToRight,
	LayoutDirection.RightToLeft,
] as const;

function document(direction: LayoutDirection): LogicDocument {
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	let bias = LayoutBias.Left;
	if (vertical) bias = LayoutBias.Top;
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'adjacent-two-by-two',
		title: 'Adjacent 2+2',
		layout: defined(layoutConfiguration(direction, bias)),
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		nodes: nodeIds.map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'task',
			markdown: id,
			layoutOrder: orderKey(`a${index}`),
		})),
		junctions: [],
		relations: [
			{ id: 'a-d', from: 'a', to: 'd' },
			{ id: 'b-d', from: 'b', to: 'd' },
			{ id: 'a-e', from: 'a', to: 'e' },
			{ id: 'c-e', from: 'c', to: 'e' },
		],
	};
}

function documentForShape(direction: LayoutDirection, shape: '2+2' | '3+1'): LogicDocument {
	const source = document(direction);
	if (shape === '2+2') return source;
	return {
		...source,
		id: 'adjacent-three-plus-one',
		title: 'Adjacent 3+1',
		relations: [
			{ id: 'a-d', from: 'a', to: 'd' },
			{ id: 'b-d', from: 'b', to: 'd' },
			{ id: 'c-d', from: 'c', to: 'd' },
			{ id: 'a-e', from: 'a', to: 'e' },
		],
	};
}

function graph(source: LogicDocument): LogicGraph {
	const built = createGraph(source);
	if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
	return built.value;
}

function measurements(sample = 0, order: readonly string[] = nodeIds): LayoutMeasurements {
	return {
		nodes: new Map(
			order.map((id) => {
				const index = nodeIds.findIndex((candidate) => candidate === id);
				let width = 80;
				let height = 60;
				if (sample !== 0) {
					width = 20.25 + ((sample * 17 + index * 29) % 191);
					height = 18.5 + ((sample * 31 + index * 11) % 157);
				}
				return [id, { width, height }] as const;
			}),
		),
		groups: new Map(),
		junctions: new Map(),
	};
}

function readyContract(source: LogicGraph, measured: LayoutMeasurements) {
	const result = buildAdjacentLayoutContract(source, topologicallyRank(source), measured);
	if (result.status !== LayoutContractBuildStatus.Ready) throw new Error(JSON.stringify(result));
	return result.contract;
}

describe('independent adjacent 2+2 contract', () => {
	it('chooses lower allocated growth before comparing route costs', () => {
		const detour: IndependentAdjacentCostCandidate = {
			growth: 104,
			cost: { area: 100, routeLength: 80, bends: 2 },
		};
		const bridge: IndependentAdjacentCostCandidate = {
			growth: 56,
			cost: { area: 500, routeLength: 300, bends: 6 },
		};
		expect(
			arbitrateIssue(detour, bridge, {
				detourAreaTolerance: 0.25,
				detourLengthTolerance: 0.2,
			}),
		).toBe(bridge);
	});

	it('couples the two target faces to each inverted order and publishes outgoing capacity', () => {
		const source = graph(document(LayoutDirection.TopToBottom));
		const contract = readyContract(source, measurements());
		expect(contract.shape).toBe('adjacent-2+2');
		expect(contract.candidates).toHaveLength(12);
		const inverted = defined(
			contract.candidates.find(
				({ sourceOrder, targetOrder }) =>
					JSON.stringify(sourceOrder) === '["a","b","c"]' &&
					JSON.stringify(targetOrder) === '["d","e"]',
			),
		);
		expect(inverted.conflicts.inversions).toEqual([
			{ firstRelationId: 'a-e', secondRelationId: 'b-d' },
		]);
		expect(inverted.conflicts.requiredSeparations).toEqual([
			{ endpointId: 'd', firstRelationId: 'a-d', secondRelationId: 'b-d' },
			{ endpointId: 'e', firstRelationId: 'a-e', secondRelationId: 'c-e' },
		]);
		for (const face of inverted.faces) {
			expect(face.alternatives).toHaveLength(2);
			expect(
				face.alternatives.map(({ respectsRequiredSeparations }) => respectsRequiredSeparations),
			).toEqual([false, true]);
			expect(defined(face.alternatives[1]).metricDemand).toMatchObject({
				portCount: 2,
				minimumCrossSize: 96,
				growth: 16,
			});
		}
		expect(inverted.sourceFaceDemands).toEqual([
			{
				endpointId: 'a',
				role: RoutingPortRole.Outgoing,
				portCount: 2,
				minimumCrossSize: 96,
				growth: 16,
			},
			...['b', 'c'].map((endpointId) => ({
				endpointId,
				role: RoutingPortRole.Outgoing,
				portCount: 1,
				minimumCrossSize: 80,
				growth: 0,
			})),
		]);
		const enlarged = satisfyMetricDemands(
			measurements(),
			[
				...inverted.sourceFaceDemands,
				...inverted.faces.map((face) => defined(face.alternatives[1]).metricDemand),
			],
			LayoutDirection.TopToBottom,
		);
		expect(enlarged.nodes.get('a')?.width).toBe(96);
		expect(enlarged.nodes.get('d')?.width).toBe(96);
		expect(enlarged.nodes.get('e')?.width).toBe(96);
		const uninverted = defined(
			contract.candidates.find(
				({ sourceOrder, targetOrder }) =>
					JSON.stringify(sourceOrder) === '["b","a","c"]' &&
					JSON.stringify(targetOrder) === '["d","e"]',
			),
		);
		expect(uninverted.conflicts.inversions).toEqual([]);
		expect(
			uninverted.faces.map((face) => defined(face.alternatives[0]).respectsRequiredSeparations),
		).toEqual([true, true]);
	});

	it.each(directions)('selects a full independently validated layout in %s', (direction) => {
		const source = graph(document(direction));
		const measured = measurements();
		const result = resolveIndependentAdjacentContract(source, topologicallyRank(source), measured);
		expect(result.status).toBe(IndependentAdjacentStatus.Selected);
		if (result.status !== IndependentAdjacentStatus.Selected) return;
		expect(result.scope).toBe('adjacent-2+2');
		expect(result.globalStatus).toBe(IndependentAdjacentGlobalStatus.Undetermined);
		const candidate = defined(
			result.contract.candidates.find(({ id }) => id === result.selection.candidateId),
		);
		expect(
			validateContractCandidate({
				graph: source,
				candidate,
				measurements: measured,
				layout: result.selection.layout,
				choices: result.selection.choices,
			}),
		).toEqual({ valid: true });
		expect(routeCrossings(result.selection.layout.relations)).toEqual([]);
		const sourceBox = defined(result.selection.layout.elements.find(({ id }) => id === 'a')).bounds;
		const vertical =
			direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
		const outgoing = result.selection.layout.relations
			.filter(({ from }) => from === 'a')
			.map(({ points }) => {
				const point = defined(points[0]);
				if (vertical) return point.x;
				return point.y;
			})
			.sort((a, b) => a - b);
		let crossStart = sourceBox.y;
		let crossSize = sourceBox.height;
		if (vertical) {
			crossStart = sourceBox.x;
			crossSize = sourceBox.width;
		}
		expect(crossSize).toBeGreaterThanOrEqual(96);
		expect(defined(outgoing[1]) - defined(outgoing[0])).toBeGreaterThanOrEqual(PORT_SPACING);
		expect(defined(outgoing[0]) - crossStart).toBeGreaterThanOrEqual(PORT_INSET);
		expect(crossStart + crossSize - defined(outgoing[1])).toBeGreaterThanOrEqual(PORT_INSET);
	});

	it('materializes an inverted branch and validates its strict crossing as a bridge', () => {
		const source = graph(document(LayoutDirection.TopToBottom));
		const measured = measurements();
		const inverted = defined(
			readyContract(source, measured).candidates.find(
				({ sourceOrder, targetOrder }) =>
					JSON.stringify(sourceOrder) === '["a","b","c"]' &&
					JSON.stringify(targetOrder) === '["d","e"]',
			),
		);
		const branch = defined(candidateFaceBranches(inverted)[0]);
		const layout = defined(
			materializeIndependentAdjacentGeometry(source, measured, inverted, branch.choices),
		);
		expect(
			validateContractCandidate({
				graph: source,
				candidate: inverted,
				measurements: measured,
				layout,
				choices: branch.choices,
			}),
		).toEqual({ valid: true });
		expect(routeCrossings(layout.relations).length).toBeGreaterThan(0);
		const analysis = routeBridgeAnalysis(layout.relations);
		expect(analysis.crossings.length).toBeGreaterThan(0);
		expect(unbridgedCrossings(analysis)).toEqual([]);
		const resolved = resolveIndependentAdjacentContract(
			source,
			topologicallyRank(source),
			measured,
		);
		expect(resolved.evaluations).toContainEqual({
			branchId: branch.id,
			status: IndependentAdjacentBranchStatus.Accepted,
		});
	});

	it('rejects a source face that lies about its demand or merges its two outgoing ports', () => {
		const source = graph(document(LayoutDirection.TopToBottom));
		const measured = measurements();
		const result = resolveIndependentAdjacentContract(source, topologicallyRank(source), measured);
		if (result.status !== IndependentAdjacentStatus.Selected)
			throw new Error('Expected a selection');
		const candidate = defined(
			result.contract.candidates.find(({ id }) => id === result.selection.candidateId),
		);
		const input = {
			graph: source,
			candidate,
			measurements: measured,
			layout: result.selection.layout,
			choices: result.selection.choices,
		};
		const largerDemand = {
			...candidate,
			sourceFaceDemands: candidate.sourceFaceDemands.map((demand) => {
				if (demand.endpointId === 'a') return { ...demand, minimumCrossSize: 1_000 };
				return demand;
			}),
		};
		expect(validateContractCandidate({ ...input, candidate: largerDemand })).toEqual({
			valid: false,
			reason: CandidateGeometryReason.MetricDemand,
		});
		const aToD = defined(result.selection.layout.relations.find(({ id }) => id === 'a-d'));
		const aToE = defined(result.selection.layout.relations.find(({ id }) => id === 'a-e'));
		const shared = defined(aToE.points[0]).x;
		const merged = {
			...result.selection.layout,
			relations: result.selection.layout.relations.map((relation) => {
				if (relation.id !== 'a-d') return relation;
				return {
					...relation,
					points: aToD.points.map((point, index) => {
						if (index < 2) return { ...point, x: shared };
						return point;
					}),
				};
			}),
		};
		expect(validateContractCandidate({ ...input, layout: merged })).toEqual({
			valid: false,
			reason: CandidateGeometryReason.Ports,
		});
	});

	it.each([LayoutDirection.TopToBottom, LayoutDirection.LeftToRight])(
		'rejects independently falsified outgoing capacity in %s',
		(direction) => {
			const source = graph(document(direction));
			const measured = measurements();
			const result = resolveIndependentAdjacentContract(
				source,
				topologicallyRank(source),
				measured,
			);
			if (result.status !== IndependentAdjacentStatus.Selected)
				throw new Error('Expected a selection');
			const candidate = defined(
				result.contract.candidates.find(({ id }) => id === result.selection.candidateId),
			);
			const layout = result.selection.layout;
			const boxes = new Map(layout.elements.map(({ id, bounds }) => [id, bounds] as const));
			const vertical = direction === LayoutDirection.TopToBottom;
			const input = { graph: source, candidate, layout, boxes, vertical };
			expect(validateSourceFaceDemands(input)).toBeUndefined();
			const demands = candidate.sourceFaceDemands;
			const firstDemand = defined(demands[0]);
			expect(
				validateSourceFaceDemands({
					...input,
					candidate: { ...candidate, sourceFaceDemands: [] },
				}),
			).toBe(SourceFaceDemandFailure.MetricDemand);
			expect(
				validateSourceFaceDemands({
					...input,
					candidate: { ...candidate, sourceFaceDemands: demands.slice(1) },
				}),
			).toBe(SourceFaceDemandFailure.MetricDemand);
			expect(
				validateSourceFaceDemands({
					...input,
					candidate: {
						...candidate,
						sourceFaceDemands: [firstDemand, firstDemand, ...demands.slice(2)],
					},
				}),
			).toBe(SourceFaceDemandFailure.MetricDemand);
			for (const changed of [
				{ ...firstDemand, endpointId: 'd' },
				{ ...firstDemand, minimumCrossSize: 1_000 },
				{ ...firstDemand, portCount: firstDemand.portCount + 1 },
			]) {
				expect(
					validateSourceFaceDemands({
						...input,
						candidate: {
							...candidate,
							sourceFaceDemands: [changed, ...demands.slice(1)],
						},
					}),
				).toBe(SourceFaceDemandFailure.MetricDemand);
			}
			const aBox = defined(boxes.get('a'));
			let start = aBox.y;
			let size = aBox.height;
			if (vertical) {
				start = aBox.x;
				size = aBox.width;
			}
			const outgoing = layout.relations
				.filter(({ from }) => from === 'a')
				.map((relation) => {
					const first = defined(relation.points[0]);
					let cross = first.y;
					if (vertical) cross = first.x;
					return { id: relation.id, cross };
				})
				.toSorted((left, right) => left.cross - right.cross);
			const low = defined(outgoing[0]);
			const high = defined(outgoing[1]);
			function movedPort(relationId: string, coordinate: number) {
				return {
					...layout,
					relations: layout.relations.map((relation) => {
						if (relation.id !== relationId) return relation;
						return {
							...relation,
							points: relation.points.map((point, index) => {
								if (index !== 0) return point;
								if (vertical) return { ...point, x: coordinate };
								return { ...point, y: coordinate };
							}),
						};
					}),
				};
			}
			for (const falsified of [
				movedPort(low.id, start + PORT_INSET - 0.25),
				movedPort(high.id, start + size - PORT_INSET + 0.25),
				movedPort(high.id, low.cross + PORT_SPACING - 0.25),
				movedPort(high.id, low.cross),
			]) {
				expect(validateSourceFaceDemands({ ...input, layout: falsified })).toBe(
					SourceFaceDemandFailure.Ports,
				);
			}
		},
	);

	it('breaks a real equal-growth area and length tie by fewer bends', () => {
		const source = graph(document(LayoutDirection.TopToBottom));
		const measured = measurements(1);
		const ranks = topologicallyRank(source);
		const resolution = resolveIndependentAdjacentContract(source, ranks, measured);
		expect(resolution.status).toBe(IndependentAdjacentStatus.Selected);
		if (resolution.status !== IndependentAdjacentStatus.Selected) return;
		const comparison = resolution.comparison;
		if (comparison === undefined) throw new Error('Expected both measured 2+2 issue candidates');
		const accepted = new Set(
			resolution.evaluations
				.filter((evaluation) => evaluation.status === IndependentAdjacentBranchStatus.Accepted)
				.map(({ branchId }) => branchId),
		);
		const contract = readyContract(source, measured);
		const detourTies = contract.candidates
			.flatMap(candidateFaceBranches)
			.flatMap((branch) =>
				[AdjacentGeometryMode.Bridge, AdjacentGeometryMode.Detour].flatMap((geometry) => {
					let branchId = branch.id;
					if (geometry === AdjacentGeometryMode.Bridge) branchId = `${branch.id}:bridge`;
					if (!accepted.has(branchId)) return [];
					let layout: ReturnType<typeof materializeIndependentAdjacentGeometry>;
					if (geometry === AdjacentGeometryMode.Bridge)
						layout = materializeIndependentAdjacentBridgeGeometry(
							source,
							measured,
							branch.candidate,
							branch.choices,
						);
					else
						layout = materializeIndependentAdjacentGeometry(
							source,
							measured,
							branch.candidate,
							branch.choices,
						);
					if (layout === undefined) return [];
					const analysis = routeBridgeAnalysis(layout.relations);
					if (unbridgedCrossings(analysis).length > 0) return [];
					if (geometry === AdjacentGeometryMode.Bridge && analysis.bridges.length === 0) return [];
					return [
						{
							bridged: analysis.crossings.length > 0,
							growth: branch.growth,
							cost: layoutRouteCost(layout),
							branchId,
						},
					];
				}),
			)
			.filter(
				(candidate) =>
					!candidate.bridged &&
					candidate.growth === comparison.detourGrowth &&
					candidate.cost.area === comparison.detour.area &&
					candidate.cost.routeLength === comparison.detour.routeLength,
			);
		expect(new Set(detourTies.map(({ cost }) => cost.bends)).size).toBeGreaterThan(1);
		expect(comparison.detour.bends).toBe(Math.min(...detourTies.map(({ cost }) => cost.bends)));
	});

	it('keeps a zero budget incomplete and preserves both adjacent shapes under collection permutations', () => {
		const source = graph(document(LayoutDirection.TopToBottom));
		const empty = resolveIndependentAdjacentContract(
			source,
			topologicallyRank(source),
			measurements(),
			{ maxBranches: 0 },
		);
		expect(empty.status).toBe(IndependentAdjacentStatus.Incomplete);
		if (empty.status !== IndependentAdjacentStatus.Incomplete) return;
		expect(empty.scope).toBe('adjacent-2+2');
		expect(empty.exploredBranches).toBe(0);

		fc.assert(
			fc.property(
				fc.constantFrom(...directions),
				fc.integer({ min: 1, max: 200 }),
				fc.constantFrom<'2+2' | '3+1'>('2+2', '3+1'),
				fc.shuffledSubarray([...nodeIds], { minLength: 5, maxLength: 5 }),
				fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
				fc.shuffledSubarray([...nodeIds], { minLength: 5, maxLength: 5 }),
				(direction, sample, shape, nodes, relationOrder, measurementOrder) => {
					const original = documentForShape(direction, shape);
					const permuted = {
						...original,
						nodes: nodes.map((id) => defined(original.nodes.find((node) => node.id === id))),
						relations: relationOrder.map((index) => defined(original.relations[index])),
					};
					const measured = measurements(sample, measurementOrder);
					const first = graph(original);
					const second = graph(permuted);
					const firstRanks = topologicallyRank(first);
					const secondRanks = topologicallyRank(second);
					expect(buildAdjacentLayoutContract(second, secondRanks, measured)).toEqual(
						buildAdjacentLayoutContract(first, firstRanks, measured),
					);
					const firstResult = resolveIndependentAdjacentContract(first, firstRanks, measured);
					const secondResult = resolveIndependentAdjacentContract(second, secondRanks, measured);
					expect(secondResult).toEqual(firstResult);
					expect(firstResult.status).toBe(IndependentAdjacentStatus.Selected);
					if (firstResult.status !== IndependentAdjacentStatus.Selected) return;
					const analysis = routeBridgeAnalysis(firstResult.selection.layout.relations);
					expect(unbridgedCrossings(analysis)).toEqual([]);
					if (firstResult.selection.bridged) {
						expect(analysis.bridges.length).toBeGreaterThan(0);
						expect(validatedBridges(firstResult.selection.layout.relations)).toHaveLength(
							analysis.crossings.length,
						);
					} else expect(analysis.crossings).toEqual([]);
				},
			),
			{ numRuns: 48, seed: 220024 },
		);
	});
});

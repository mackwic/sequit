import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import { createGraph, type LogicGraph } from '../../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../../src/lib/core/graph/topological-ranks';
import { candidateFaceBranches } from '../../../../../src/lib/core/layout/contract/candidate-face-branches';
import * as candidateLayout from '../../../../../src/lib/core/layout/contract/candidate-layout';
import { materializeContractCandidate } from '../../../../../src/lib/core/layout/contract/candidate-layout';
import * as independentGeometry from '../../../../../src/lib/core/layout/contract/independent-adjacent-geometry';
import { materializeIndependentAdjacentGeometry } from '../../../../../src/lib/core/layout/contract/independent-adjacent-geometry';
import {
	IndependentAdjacentBranchStatus,
	IndependentAdjacentGlobalStatus,
	IndependentAdjacentStatus,
	resolveIndependentAdjacentContract,
} from '../../../../../src/lib/core/layout/contract/independent-adjacent-resolution';
import * as layoutContract from '../../../../../src/lib/core/layout/contract/layout-contract';
import {
	AdjacentContractShape,
	buildAdjacentLayoutContract,
	LayoutContractBuildStatus,
	LayoutContractUnknownReason,
} from '../../../../../src/lib/core/layout/contract/layout-contract';
import {
	ContractBranchStatus,
	LayoutContractResolutionStatus,
	resolveAdjacentLayoutContract,
} from '../../../../../src/lib/core/layout/contract/resolve-contract';
import * as geometryValidation from '../../../../../src/lib/core/layout/contract/validate-candidate';
import {
	type CandidateFaceChoice,
	CandidateGeometryReason,
	validateContractCandidate,
} from '../../../../../src/lib/core/layout/contract/validate-candidate';
import * as layoutEngine from '../../../../../src/lib/core/layout/layout-engine';
import { layoutWithDedicatedEngine } from '../../../../../src/lib/core/layout/layout-engine';
import type {
	LayoutMeasurements,
	LayoutResult,
} from '../../../../../src/lib/core/layout/layout-types';

afterEach(() => vi.restoreAllMocks());

function sparseDocument(direction: LayoutDirection): LogicDocument {
	let bias = LayoutBias.Left;
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop)
		bias = LayoutBias.Top;
	const layout = defined(layoutConfiguration(direction, bias));
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'contract-sparse',
		title: 'Adjacent 3+1',
		layout,
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		nodes: ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
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
			{ id: 'c-d', from: 'c', to: 'd' },
			{ id: 'a-e', from: 'a', to: 'e' },
		],
	};
}

type AdjacentShape = '3+1' | '2+2';

function adjacentDocument(
	direction: LayoutDirection,
	shape: AdjacentShape,
	permuted: boolean,
): LogicDocument {
	const original = sparseDocument(direction);
	let relations = original.relations;
	if (shape === '2+2')
		relations = [
			...original.relations.filter(({ id }) => id !== 'c-d'),
			{ id: 'c-e', from: 'c', to: 'e' },
		];
	let nodes = original.nodes;
	if (permuted) {
		nodes = [...nodes].reverse();
		relations = [...relations].reverse();
	}
	return { ...original, nodes, relations };
}

function graph(document: LogicDocument): LogicGraph {
	const result = createGraph(document);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	return result.value;
}

function measurements(): LayoutMeasurements {
	return {
		nodes: new Map(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { width: 80, height: 60 }])),
		groups: new Map(),
		junctions: new Map(),
	};
}

function fractionalMeasurements(sample: number): LayoutMeasurements {
	return {
		nodes: new Map(
			['a', 'b', 'c', 'd', 'e'].map(
				(id, index) =>
					[
						id,
						{
							width: 20.25 + ((sample * 17 + index * 29) % 191),
							height: 18.5 + ((sample * 31 + index * 11) % 157),
						},
					] as const,
			),
		),
		groups: new Map(),
		junctions: new Map(),
	};
}

function strictCrossing(
	a: readonly [number, number, number, number],
	b: readonly [number, number, number, number],
): boolean {
	const [ax1, ay1, ax2, ay2] = a;
	const [bx1, by1, bx2, by2] = b;
	if (ax1 === ax2 && by1 === by2) {
		const alongA = by1 > Math.min(ay1, ay2) && by1 < Math.max(ay1, ay2);
		const alongB = ax1 > Math.min(bx1, bx2) && ax1 < Math.max(bx1, bx2);
		return alongA && alongB;
	}
	if (ay1 === ay2 && bx1 === bx2) {
		const alongA = bx1 > Math.min(ax1, ax2) && bx1 < Math.max(ax1, ax2);
		const alongB = ay1 > Math.min(by1, by2) && ay1 < Math.max(by1, by2);
		return alongA && alongB;
	}
	return false;
}

function routeSegments(points: readonly { readonly x: number; readonly y: number }[]) {
	return points.slice(1).map((end, index) => {
		const start = defined(points[index]);
		return [start.x, start.y, end.x, end.y] as const;
	});
}

function hasStrictRouteCrossing(layout: LayoutResult): boolean {
	for (const [index, first] of layout.relations.entries()) {
		for (const second of layout.relations.slice(index + 1)) {
			for (const firstSegment of routeSegments(first.points))
				for (const secondSegment of routeSegments(second.points))
					if (strictCrossing(firstSegment, secondSegment)) return true;
		}
	}
	return false;
}

interface BranchCost {
	readonly branchId: string;
	readonly growth: number;
	readonly area: number;
	readonly routeLength: number;
	readonly bends: number;
}

function branchCost(branchId: string, growth: number, layout: LayoutResult): BranchCost {
	let routeLength = 0;
	let bends = 0;
	for (const relation of layout.relations) {
		let previousAxis: 'horizontal' | 'vertical' | undefined;
		for (const [x1, y1, x2, y2] of routeSegments(relation.points)) {
			const dx = x2 - x1;
			const dy = y2 - y1;
			routeLength += Math.abs(dx) + Math.abs(dy);
			if (dx === 0 && dy === 0) continue;
			let axis: 'horizontal' | 'vertical' = 'horizontal';
			if (dx === 0) axis = 'vertical';
			if (previousAxis !== undefined && axis !== previousAxis) bends += 1;
			previousAxis = axis;
		}
	}
	return {
		branchId,
		growth,
		area: layout.width * layout.height,
		routeLength,
		bends,
	};
}

function dominates(left: BranchCost, right: BranchCost): boolean {
	const noWorse =
		left.growth <= right.growth &&
		left.area <= right.area &&
		left.routeLength <= right.routeLength &&
		left.bends <= right.bends;
	const better =
		left.growth < right.growth ||
		left.area < right.area ||
		left.routeLength < right.routeLength ||
		left.bends < right.bends;
	return noWorse && better;
}

describe('adjacent node LayoutContract', () => {
	const directions = [
		LayoutDirection.TopToBottom,
		LayoutDirection.BottomToTop,
		LayoutDirection.LeftToRight,
		LayoutDirection.RightToLeft,
	] as const;
	it('retains candidate conflicts, port alternatives and metric demands', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const result = buildAdjacentLayoutContract(source, topologicallyRank(source), measurements());
		expect(result.status).toBe(LayoutContractBuildStatus.Ready);
		if (result.status !== LayoutContractBuildStatus.Ready) return;
		expect(result.contract.candidates).toHaveLength(12);
		const crossing = result.contract.candidates.find(
			({ sourceOrder, targetOrder }) =>
				JSON.stringify(sourceOrder) === '["a","b","c"]' &&
				JSON.stringify(targetOrder) === '["d","e"]',
		);
		expect(crossing?.conflicts.inversions).toHaveLength(2);
		expect(crossing?.conflicts.requiredSeparations).toHaveLength(3);
		const face = crossing?.faces.find(({ endpointId }) => endpointId === 'd');
		expect(face?.alternatives).toHaveLength(5);
		expect(
			face?.alternatives.filter(({ respectsRequiredSeparations }) => respectsRequiredSeparations),
		).toHaveLength(1);
		expect(
			face?.alternatives.find(({ portGroups }) => portGroups.length === 3)?.metricDemand,
		).toMatchObject({
			endpointId: 'd',
			portCount: 3,
			minimumCrossSize: 144,
			growth: 64,
		});
		expect(crossing?.sourceFaceDemands.find(({ endpointId }) => endpointId === 'a')).toMatchObject({
			portCount: 2,
			minimumCrossSize: 96,
			growth: 16,
		});
	});

	it('returns an incomplete search with a zero branch budget', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const result = resolveAdjacentLayoutContract(
			source,
			topologicallyRank(source),
			measurements(),
			{
				maxBranches: 0,
			},
		);
		expect(result.status).toBe(LayoutContractResolutionStatus.Incomplete);
		if (result.status !== LayoutContractResolutionStatus.Incomplete) return;
		expect(result.exploredBranches).toBe(0);
		expect(result.evaluations).toEqual([]);
	});

	it.each(directions)('selects a geometrically validated full LayoutResult in %s', (direction) => {
		const source = graph(sparseDocument(direction));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const result = resolveAdjacentLayoutContract(source, ranks, measured);
		expect(result.status).toBe(LayoutContractResolutionStatus.Selected);
		if (result.status !== LayoutContractResolutionStatus.Selected) return;
		expect(result.selection.layout).toEqual(layoutWithDedicatedEngine(source, ranks, measured));
		expect(
			result.evaluations.some(({ status }) => status === ContractBranchStatus.GeometryRejected),
		).toBe(true);
	});

	it.each(directions)(
		'characterizes independent 3+1 and 2+2 against the dedicated engine in %s',
		(direction) => {
			for (const shape of ['3+1', '2+2'] as const) {
				for (const sample of [undefined, 1, 19]) {
					let measured = measurements();
					if (sample !== undefined) measured = fractionalMeasurements(sample);
					const variants = [false, true].map((permuted) => {
						const source = graph(adjacentDocument(direction, shape, permuted));
						const ranks = topologicallyRank(source);
						const independent = resolveIndependentAdjacentContract(source, ranks, measured);
						if (independent.status !== IndependentAdjacentStatus.Selected)
							throw new Error(
								`No independent ${shape} selection for ${direction}, sample ${sample}`,
							);
						const dedicated = layoutWithDedicatedEngine(source, ranks, measured);
						const geometryBranches = independent.contract.candidates
							.flatMap(candidateFaceBranches)
							.filter(
								({ candidate, choices }) =>
									validateContractCandidate({
										graph: source,
										measurements: measured,
										candidate,
										choices,
										layout: dedicated,
									}).valid,
							);
						// The dedicated result satisfies one candidate's geometry but has a strict crossing.
						expect(geometryBranches).toHaveLength(1);
						const dedicatedBranch = defined(geometryBranches[0]);
						const sameBranchIndependent = materializeIndependentAdjacentGeometry(
							source,
							measured,
							dedicatedBranch.candidate,
							dedicatedBranch.choices,
						);
						expect(sameBranchIndependent).toBeDefined();
						expect(sameBranchIndependent).not.toEqual(dedicated);
						expect(hasStrictRouteCrossing(defined(sameBranchIndependent))).toBe(true);
						expect(independent.evaluations).toContainEqual({
							branchId: dedicatedBranch.id,
							status: IndependentAdjacentBranchStatus.CrossingRejected,
						});
						expect(hasStrictRouteCrossing(dedicated)).toBe(true);
						expect(hasStrictRouteCrossing(independent.selection.layout)).toBe(false);
						expect(dedicatedBranch.id).not.toBe(independent.selection.branchId);
						expect(independent.selection.growth).toBeLessThanOrEqual(dedicatedBranch.growth);
						expect(
							independent.selection.layout.width * independent.selection.layout.height,
						).toBeGreaterThan(dedicated.width * dedicated.height);
						expect(JSON.stringify(independent.selection.layout)).not.toBe(
							JSON.stringify(dedicated),
						);
						return {
							independent: independent.selection.layout,
							dedicated,
							independentBranchId: independent.selection.branchId,
							dedicatedBranchId: dedicatedBranch.id,
						};
					});
					expect(variants[1]).toEqual(variants[0]);
				}
			}
		},
	);

	it('keeps an adjacent graph outside the two declared shapes unknown', () => {
		const original = sparseDocument(LayoutDirection.TopToBottom);
		const source = graph({
			...original,
			relations: original.relations.filter(({ id }) => id !== 'a-e'),
		});
		const ranks = topologicallyRank(source);
		const measured = measurements();
		expect(resolveIndependentAdjacentContract(source, ranks, measured)).toEqual({
			status: IndependentAdjacentStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
			evaluations: [],
		});
		expect(layoutWithDedicatedEngine(source, ranks, measured).relations).toHaveLength(3);
	});

	it.each(directions)(
		'keeps the selected branch on the bounded 3+1 and 2+2 Pareto frontier in %s',
		(direction) => {
			for (const shape of ['3+1', '2+2'] as const)
				for (const sample of [undefined, 1, 19, 7, 73]) {
					let measured = measurements();
					if (sample !== undefined) measured = fractionalMeasurements(sample);
					const variants = [false, true].map((permuted) => {
						const source = graph(adjacentDocument(direction, shape, permuted));
						const result = resolveIndependentAdjacentContract(
							source,
							topologicallyRank(source),
							measured,
						);
						if (result.status !== IndependentAdjacentStatus.Selected)
							throw new Error(`No ${shape} selection in ${direction}, sample ${sample}`);
						const acceptedIds = new Set(
							result.evaluations
								.filter(({ status }) => status === IndependentAdjacentBranchStatus.Accepted)
								.map(({ branchId }) => branchId),
						);
						const costs = result.contract.candidates
							.flatMap(candidateFaceBranches)
							.filter(({ id }) => acceptedIds.has(id))
							.map((branch) => {
								const layout = materializeIndependentAdjacentGeometry(
									source,
									measured,
									branch.candidate,
									branch.choices,
								);
								if (layout === undefined) throw new Error(`Accepted branch ${branch.id} vanished`);
								return branchCost(branch.id, branch.growth, layout);
							});
						expect(costs).toHaveLength(acceptedIds.size);
						const incumbent = defined(
							costs.find(({ branchId }) => branchId === result.selection.branchId),
						);
						const dominators = costs.filter((cost) => dominates(cost, incumbent));
						const frontier = costs.filter((cost) => !costs.some((other) => dominates(other, cost)));
						const witness = { direction, shape, sample, permuted, incumbent, dominators };
						expect(dominators, JSON.stringify(witness)).toEqual([]);
						if (shape === '3+1') {
							expect(costs).toHaveLength(16);
							expect(frontier).toHaveLength(8);
						} else {
							expect(costs).toHaveLength(9);
							expect(frontier).toHaveLength(2);
						}
						return { costs, frontier: frontier.map(({ branchId }) => branchId), incumbent };
					});
					expect(variants[1]).toEqual(variants[0]);
				}
		},
	);

	it.each(directions)(
		'materializes a zero-inversion contract without calling the dedicated engine in %s',
		(direction) => {
			const source = graph(sparseDocument(direction));
			const measured = measurements();
			const built = buildAdjacentLayoutContract(source, topologicallyRank(source), measured);
			expect(built.status).toBe(LayoutContractBuildStatus.Ready);
			if (built.status !== LayoutContractBuildStatus.Ready) return;
			let selected: LayoutResult | undefined;
			for (const candidate of built.contract.candidates) {
				if (candidate.conflicts.inversions.length > 0) continue;
				const choices = candidate.faces.map((face) => {
					const alternative = face.alternatives.find(
						(item) => item.respectsRequiredSeparations && item.metricDemand.growth === 0,
					);
					if (alternative === undefined) throw new Error('Expected a zero-growth choice');
					return {
						endpointId: face.endpointId,
						physicalPortGroups: defined(alternative.physicalOrders[0]),
						metricDemand: alternative.metricDemand,
					};
				});
				const layout = materializeIndependentAdjacentGeometry(source, measured, candidate, choices);
				if (layout === undefined) continue;
				const valid = validateContractCandidate({
					graph: source,
					measurements: measured,
					candidate,
					choices,
					layout,
				});
				if (!valid.valid) continue;
				selected = layout;
				break;
			}
			expect(selected).toBeDefined();
			expect(selected).not.toEqual(
				layoutWithDedicatedEngine(source, topologicallyRank(source), measured),
			);
		},
	);

	it.each(directions)(
		'materializes and geometrically checks an inverted order under permutation in %s',
		(direction) => {
			const document = sparseDocument(direction);
			const source = graph(document);
			const measured = measurements();
			const built = buildAdjacentLayoutContract(source, topologicallyRank(source), measured);
			expect(built.status).toBe(LayoutContractBuildStatus.Ready);
			if (built.status !== LayoutContractBuildStatus.Ready) return;
			const candidate = defined(
				built.contract.candidates.find(
					({ sourceOrder, targetOrder }) =>
						JSON.stringify(sourceOrder) === '["a","b","c"]' &&
						JSON.stringify(targetOrder) === '["d","e"]',
				),
			);
			expect(candidate.conflicts.inversions).toHaveLength(2);
			const faceChoices = candidate.faces.map((face) =>
				face.alternatives.flatMap((alternative) => {
					if (!alternative.respectsRequiredSeparations) return [];
					return alternative.physicalOrders.map((physicalPortGroups) => ({
						endpointId: face.endpointId,
						physicalPortGroups,
						metricDemand: alternative.metricDemand,
					}));
				}),
			);
			let witness:
				| {
						readonly choices: readonly CandidateFaceChoice[];
						readonly layout: LayoutResult;
						readonly branchId: string;
				  }
				| undefined;
			const outcomes: string[] = [];
			for (const first of defined(faceChoices[0])) {
				for (const second of defined(faceChoices[1])) {
					const choices = [first, second];
					const layout = materializeIndependentAdjacentGeometry(
						source,
						measured,
						candidate,
						choices,
					);
					if (layout === undefined) {
						outcomes.push('materialization-failed');
						continue;
					}
					const checked = validateContractCandidate({
						graph: source,
						measurements: measured,
						candidate,
						choices,
						layout,
					});
					if (!checked.valid) {
						outcomes.push(checked.reason);
						continue;
					}
					if (!hasStrictRouteCrossing(layout)) {
						outcomes.push('no-strict-crossing');
						continue;
					}
					witness = {
						choices,
						layout,
						branchId: JSON.stringify([
							candidate.id,
							[first.physicalPortGroups, second.physicalPortGroups],
						]),
					};
					break;
				}
				if (witness !== undefined) break;
			}
			if (witness === undefined)
				throw new Error(`No validated inverted materialization: ${JSON.stringify(outcomes)}`);

			const permutedDocument = {
				...document,
				nodes: [...document.nodes].reverse(),
				relations: [...document.relations].reverse(),
			};
			const permutedGraph = graph(permutedDocument);
			const permutedMeasurements = {
				...measured,
				nodes: new Map([...measured.nodes].reverse()),
			};
			const permutedBuild = buildAdjacentLayoutContract(
				permutedGraph,
				topologicallyRank(permutedGraph),
				permutedMeasurements,
			);
			expect(permutedBuild).toEqual(built);
			const replay = materializeIndependentAdjacentGeometry(
				permutedGraph,
				permutedMeasurements,
				candidate,
				witness.choices,
			);
			expect(replay).toEqual(witness.layout);
			expect(
				validateContractCandidate({
					graph: permutedGraph,
					measurements: permutedMeasurements,
					candidate,
					choices: witness.choices,
					layout: defined(replay),
				}),
			).toEqual({ valid: true });
			const result = resolveIndependentAdjacentContract(
				source,
				topologicallyRank(source),
				measured,
			);
			expect(result.status).toBe(IndependentAdjacentStatus.Selected);
			if (result.status !== IndependentAdjacentStatus.Selected) return;
			expect(result.omittedCrossingCandidates).toBe(0);
			expect(result.globalStatus).toBe(IndependentAdjacentGlobalStatus.Undetermined);
			expect(result.evaluations).toContainEqual({
				branchId: witness.branchId,
				status: IndependentAdjacentBranchStatus.CrossingRejected,
			});
		},
	);

	it.each(directions)(
		'resolves the adjacent contract without the legacy materializer in %s',
		(direction) => {
			const source = graph(sparseDocument(direction));
			const ranks = topologicallyRank(source);
			const measured = measurements();
			vi.spyOn(layoutEngine, 'layoutWithDedicatedEngine').mockImplementation(() => {
				throw new Error('Legacy engine must not be called');
			});
			vi.spyOn(candidateLayout, 'materializeContractCandidate').mockImplementation(() => {
				throw new Error('Legacy materializer must not be called');
			});
			const result = resolveIndependentAdjacentContract(source, ranks, measured);
			expect(result.status).toBe(IndependentAdjacentStatus.Selected);
			if (result.status !== IndependentAdjacentStatus.Selected) return;
			expect(result.globalStatus).toBe(IndependentAdjacentGlobalStatus.Undetermined);
			expect(result.omittedCrossingCandidates).toBe(0);
			expect(result.scope).toBe('adjacent-3+1');
			expect(result.exploredBranches).toBe(result.totalBranches);
			expect(
				result.evaluations.some(
					({ status }) => status === IndependentAdjacentBranchStatus.Accepted,
				),
			).toBe(true);
			expect(result.selection.growth).toBe(0);
			const candidate = defined(
				result.contract.candidates.find(({ id }) => id === result.selection.candidateId),
			);
			expect(candidate.conflicts.inversions).toEqual([]);
			expect(
				validateContractCandidate({
					graph: source,
					measurements: measured,
					candidate,
					choices: result.selection.choices,
					layout: result.selection.layout,
				}),
			).toEqual({ valid: true });
			expect(hasStrictRouteCrossing(result.selection.layout)).toBe(false);
		},
	);

	it('preserves an independent incumbent when the branch budget truncates the search', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const full = resolveIndependentAdjacentContract(source, ranks, measured);
		expect(full.status).toBe(IndependentAdjacentStatus.Selected);
		if (full.status !== IndependentAdjacentStatus.Selected) return;
		const firstAccepted = full.evaluations.findIndex(
			({ status }) => status === IndependentAdjacentBranchStatus.Accepted,
		);
		expect(firstAccepted).toBeGreaterThanOrEqual(0);
		const partial = resolveIndependentAdjacentContract(source, ranks, measured, {
			maxBranches: firstAccepted + 1,
		});
		expect(partial.status).toBe(IndependentAdjacentStatus.Incomplete);
		if (partial.status !== IndependentAdjacentStatus.Incomplete) return;
		expect(partial.incumbent).toBeDefined();
		expect(partial.exploredBranches).toBe(firstAccepted + 1);
		expect(partial.globalStatus).toBe(IndependentAdjacentGlobalStatus.Undetermined);
	});

	it('keeps the independent search incomplete at zero budget and rejects unsupported input', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const empty = resolveIndependentAdjacentContract(source, ranks, measured, {
			maxBranches: 0,
		});
		expect(empty.status).toBe(IndependentAdjacentStatus.Incomplete);
		if (empty.status !== IndependentAdjacentStatus.Incomplete) return;
		expect(empty.exploredBranches).toBe(0);
		expect(empty.incumbent).toBeUndefined();
		for (const maxBranches of [-1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
			expect(() =>
				resolveIndependentAdjacentContract(source, ranks, measured, {
					maxBranches,
				}),
			).toThrow('Layout contract budget must be a non-negative safe integer');
		expect(resolveIndependentAdjacentContract(source, { ...ranks, bands: [] }, measured)).toEqual({
			status: IndependentAdjacentStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
			evaluations: [],
		});
	});

	it('does not explore a face alternative forbidden by the coordinate-free contract', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const original = buildAdjacentLayoutContract(source, ranks, measured);
		expect(original.status).toBe(LayoutContractBuildStatus.Ready);
		if (original.status !== LayoutContractBuildStatus.Ready) return;
		const baseline = resolveIndependentAdjacentContract(source, ranks, measured);
		expect(baseline.status).toBe(IndependentAdjacentStatus.Selected);
		if (baseline.status !== IndependentAdjacentStatus.Selected) return;
		const candidateId = baseline.selection.candidateId;
		const changed = {
			...original,
			contract: {
				...original.contract,
				candidates: original.contract.candidates.map((candidate) => {
					if (candidate.id !== candidateId) return candidate;
					return {
						...candidate,
						faces: candidate.faces.map((face, index) => {
							if (index !== 0) return face;
							return {
								...face,
								alternatives: face.alternatives.map((alternative, alternativeIndex) => {
									if (alternativeIndex !== 0) return alternative;
									return {
										...alternative,
										respectsRequiredSeparations: false,
									};
								}),
							};
						}),
					};
				}),
			},
		};
		vi.spyOn(layoutContract, 'buildAdjacentLayoutContract').mockReturnValue(changed);
		const restricted = resolveIndependentAdjacentContract(source, ranks, measured);
		expect(restricted.status).toBe(IndependentAdjacentStatus.Selected);
		if (restricted.status !== IndependentAdjacentStatus.Selected) return;
		expect(restricted.totalBranches).toBeLessThan(baseline.totalBranches);
		expect(restricted.exploredBranches).toBe(restricted.totalBranches);
	});

	it('does not select an independent branch when its materialization or validation fails', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const materialize = vi
			.spyOn(independentGeometry, 'materializeIndependentAdjacentGeometry')
			.mockReturnValue(undefined);
		const failed = resolveIndependentAdjacentContract(source, ranks, measured);
		expect(failed.status).toBe(IndependentAdjacentStatus.Unknown);
		expect(failed.evaluations).not.toHaveLength(0);
		expect(
			failed.evaluations.every(
				({ status }) => status === IndependentAdjacentBranchStatus.MaterializationFailed,
			),
		).toBe(true);
		materialize.mockRestore();
		const validate = vi.spyOn(geometryValidation, 'validateContractCandidate').mockReturnValue({
			valid: false,
			reason: CandidateGeometryReason.Obstacle,
		});
		const rejected = resolveIndependentAdjacentContract(source, ranks, measured);
		expect(rejected.status).toBe(IndependentAdjacentStatus.Unknown);
		expect(
			rejected.evaluations.every(
				({ status }) => status === IndependentAdjacentBranchStatus.GeometryRejected,
			),
		).toBe(true);
		validate.mockRestore();
	});

	it('rejects a strict route crossing even if the box validator admits its geometry', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const full = resolveIndependentAdjacentContract(source, ranks, measured);
		expect(full.status).toBe(IndependentAdjacentStatus.Selected);
		if (full.status !== IndependentAdjacentStatus.Selected) return;
		const first = defined(full.selection.layout.relations[0]);
		const second = defined(full.selection.layout.relations[1]);
		const crossing: LayoutResult = {
			...full.selection.layout,
			relations: [
				{
					...first,
					points: [
						{ x: 0, y: 0 },
						{ x: 0, y: 100 },
					],
				},
				{
					...second,
					points: [
						{ x: -10, y: 50 },
						{ x: 10, y: 50 },
					],
				},
				...full.selection.layout.relations.slice(2),
			],
		};
		expect(hasStrictRouteCrossing(crossing)).toBe(true);
		vi.spyOn(independentGeometry, 'materializeIndependentAdjacentGeometry').mockReturnValue(
			crossing,
		);
		vi.spyOn(geometryValidation, 'validateContractCandidate').mockReturnValue({
			valid: true,
		});
		const rejected = resolveIndependentAdjacentContract(source, ranks, measured);
		expect(rejected.status).toBe(IndependentAdjacentStatus.Unknown);
		expect(
			rejected.evaluations.every(
				({ status }) => status === IndependentAdjacentBranchStatus.CrossingRejected,
			),
		).toBe(true);
	});

	it('does not materialize a malformed adjacent face contract', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const measured = measurements();
		const built = buildAdjacentLayoutContract(source, topologicallyRank(source), measured);
		expect(built.status).toBe(LayoutContractBuildStatus.Ready);
		if (built.status !== LayoutContractBuildStatus.Ready) return;
		const candidate = defined(
			built.contract.candidates.find(({ conflicts }) => conflicts.inversions.length === 0),
		);
		const choices = candidate.faces.map((face) => {
			const alternative = defined(
				face.alternatives.find(({ respectsRequiredSeparations }) => respectsRequiredSeparations),
			);
			return {
				endpointId: face.endpointId,
				physicalPortGroups: defined(alternative.physicalOrders[0]),
				metricDemand: alternative.metricDemand,
			};
		});
		expect(
			materializeIndependentAdjacentGeometry(
				source,
				measured,
				{ ...candidate, sourceOrder: candidate.sourceOrder.slice(1) },
				choices,
			),
		).toBeUndefined();
		expect(
			materializeIndependentAdjacentGeometry(source, measured, candidate, choices.slice(1)),
		).toBeUndefined();
		expect(
			materializeIndependentAdjacentGeometry(source, measured, candidate, [
				{ ...defined(choices[0]), endpointId: 'foreign' },
				defined(choices[1]),
			]),
		).toBeUndefined();
		const missingNodes = new Map(measured.nodes);
		missingNodes.delete('a');
		expect(
			materializeIndependentAdjacentGeometry(
				source,
				{ ...measured, nodes: missingNodes },
				candidate,
				choices,
			),
		).toBeUndefined();
		const duplicatePort = {
			...defined(choices.find(({ endpointId }) => endpointId === 'd')),
			physicalPortGroups: [['a-d'], ['a-d']],
		};
		const singlePort = defined(choices.find(({ endpointId }) => endpointId === 'e'));
		expect(
			materializeIndependentAdjacentGeometry(source, measured, candidate, [
				duplicatePort,
				singlePort,
			]),
		).toBeUndefined();
		const targetChoice = defined(choices.find(({ endpointId }) => endpointId === 'd'));
		expect(
			materializeIndependentAdjacentGeometry(source, measured, candidate, [
				{ ...targetChoice, physicalPortGroups: [['a-d']] },
				singlePort,
			]),
		).toBeUndefined();
		expect(
			materializeIndependentAdjacentGeometry(source, measured, candidate, [
				{ ...targetChoice, physicalPortGroups: [['a-d', 'b-d', 'foreign']] },
				singlePort,
			]),
		).toBeUndefined();
	});

	it('materializes parallel relations deterministically with distinct source ports', () => {
		const relations = [
			{ id: 'a-d', from: 'a', to: 'd' },
			{ id: 'a-d-2', from: 'a', to: 'd' },
			{ id: 'b-d', from: 'b', to: 'd' },
			{ id: 'c-e', from: 'c', to: 'e' },
		];
		const document = {
			...sparseDocument(LayoutDirection.TopToBottom),
			relations,
		};
		const source = graph(document);
		const permuted = graph({
			...document,
			relations: [...relations].reverse(),
		});
		const measured = measurements();
		const built = buildAdjacentLayoutContract(source, topologicallyRank(source), measured);
		expect(built.status).toBe(LayoutContractBuildStatus.Ready);
		if (built.status !== LayoutContractBuildStatus.Ready) return;
		const candidate = defined(
			built.contract.candidates.find(
				({ sourceOrder, targetOrder }) =>
					JSON.stringify(sourceOrder) === '["a","b","c"]' &&
					JSON.stringify(targetOrder) === '["d","e"]',
			),
		);
		const choices = candidate.faces.map((face) => {
			const alternative = defined(
				face.alternatives.find(({ respectsRequiredSeparations }) => respectsRequiredSeparations),
			);
			return {
				endpointId: face.endpointId,
				physicalPortGroups: defined(alternative.physicalOrders[0]),
				metricDemand: alternative.metricDemand,
			};
		});
		const layout = defined(
			materializeIndependentAdjacentGeometry(source, measured, candidate, choices),
		);
		expect(materializeIndependentAdjacentGeometry(permuted, measured, candidate, choices)).toEqual(
			layout,
		);
		const first = defined(layout.relations.find(({ id }) => id === 'a-d')).points[0];
		const second = defined(layout.relations.find(({ id }) => id === 'a-d-2')).points[0];
		expect(first).not.toEqual(second);
	});

	it.each(directions)(
		'validates independent corridor geometry with fractional size changes and input permutations in %s',
		(direction) => {
			const document = sparseDocument(direction);
			const source = graph(document);
			const permuted = graph({
				...document,
				nodes: [...document.nodes].reverse(),
				relations: [...document.relations].reverse(),
			});
			for (let sample = 0; sample < 128; sample += 1) {
				const measured = fractionalMeasurements(sample);
				const built = buildAdjacentLayoutContract(source, topologicallyRank(source), measured);
				if (built.status !== LayoutContractBuildStatus.Ready)
					throw new Error('Expected a contract');
				const candidate = built.contract.candidates.find(
					({ sourceOrder, targetOrder }) =>
						JSON.stringify(sourceOrder) === '["a","b","c"]' &&
						JSON.stringify(targetOrder) === '["e","d"]',
				);
				if (candidate === undefined) throw new Error('Expected non-crossing candidate');
				const choices = candidate.faces.map((face) => {
					const alternative = face.alternatives.find((item) => item.respectsRequiredSeparations);
					if (alternative === undefined) throw new Error('Expected a face alternative');
					return {
						endpointId: face.endpointId,
						physicalPortGroups: defined(alternative.physicalOrders[0]),
						metricDemand: alternative.metricDemand,
					};
				});
				const layout = materializeIndependentAdjacentGeometry(source, measured, candidate, choices);
				if (layout === undefined) throw new Error('Independent materialization failed');
				expect(
					validateContractCandidate({
						graph: source,
						measurements: measured,
						candidate,
						choices,
						layout,
					}),
				).toEqual({ valid: true });
				expect(hasStrictRouteCrossing(layout)).toBe(false);
				expect(
					materializeIndependentAdjacentGeometry(permuted, measured, candidate, choices),
				).toEqual(layout);
				if (sample % 8 === 0) {
					const resolved = resolveIndependentAdjacentContract(
						source,
						topologicallyRank(source),
						measured,
					);
					expect(resolved.status).toBe(IndependentAdjacentStatus.Selected);
					if (resolved.status !== IndependentAdjacentStatus.Selected) continue;
					expect(hasStrictRouteCrossing(resolved.selection.layout)).toBe(false);
					expect(
						resolveIndependentAdjacentContract(permuted, topologicallyRank(permuted), measured),
					).toEqual(resolved);
				}
			}
		},
	);

	it('keeps permutations of source collections observationally identical', () => {
		const document = sparseDocument(LayoutDirection.TopToBottom);
		const permuted: LogicDocument = {
			...document,
			nodes: [...document.nodes].reverse(),
			relations: [...document.relations].reverse(),
		};
		const original = graph(document);
		const shuffled = graph(permuted);
		const measured = measurements();
		expect(buildAdjacentLayoutContract(shuffled, topologicallyRank(shuffled), measured)).toEqual(
			buildAdjacentLayoutContract(original, topologicallyRank(original), measured),
		);
		const result = resolveAdjacentLayoutContract(shuffled, topologicallyRank(shuffled), measured);
		const baseline = resolveAdjacentLayoutContract(original, topologicallyRank(original), measured);
		expect(result).toEqual(baseline);
	});

	it('rejects an attachment, obstacle, port or metric falsification of a selected candidate', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const result = resolveAdjacentLayoutContract(source, ranks, measured);
		expect(result.status).toBe(LayoutContractResolutionStatus.Selected);
		if (result.status !== LayoutContractResolutionStatus.Selected) return;
		const candidate = result.contract.candidates.find(
			({ id }) => id === result.selection.candidateId,
		);
		if (candidate === undefined) throw new Error('Selected candidate missing');
		const layout = materializeContractCandidate(source, measured, candidate);
		if (layout === undefined) throw new Error('Selected materialization missing');
		const input = {
			graph: source,
			candidate,
			measurements: measured,
			layout,
			choices: result.selection.choices,
		};
		expect(validateContractCandidate(input)).toEqual({ valid: true });
		const checkLayout = (changed: LayoutResult, reason: CandidateGeometryReason) => {
			expect(validateContractCandidate({ ...input, layout: changed })).toEqual({
				valid: false,
				reason,
			});
		};
		checkLayout(
			{ ...layout, elements: layout.elements.slice(1) },
			CandidateGeometryReason.Elements,
		);
		const firstElement = layout.elements[0];
		const secondElement = layout.elements[1];
		if (firstElement === undefined || secondElement === undefined)
			throw new Error('Selected boxes missing');
		checkLayout(
			{
				...layout,
				elements: [firstElement, firstElement, ...layout.elements.slice(2)],
			},
			CandidateGeometryReason.Elements,
		);
		checkLayout(
			{
				...layout,
				elements: [
					{
						...firstElement,
						bounds: { ...firstElement.bounds, width: Number.NaN },
					},
					...layout.elements.slice(1),
				],
			},
			CandidateGeometryReason.Bounds,
		);
		checkLayout(
			{
				...layout,
				elements: [
					{ ...firstElement, bounds: { ...firstElement.bounds, width: 1 } },
					...layout.elements.slice(1),
				],
			},
			CandidateGeometryReason.Bounds,
		);
		checkLayout(
			{
				...layout,
				elements: [
					{ ...firstElement, bounds: { ...firstElement.bounds, x: -1 } },
					...layout.elements.slice(1),
				],
			},
			CandidateGeometryReason.Bounds,
		);
		checkLayout({ ...layout, width: 1 }, CandidateGeometryReason.Bounds);
		checkLayout({ ...layout, width: Number.NaN }, CandidateGeometryReason.Bounds);
		checkLayout(
			{
				...layout,
				elements: [
					firstElement,
					{ ...secondElement, bounds: firstElement.bounds },
					...layout.elements.slice(2),
				],
			},
			CandidateGeometryReason.Bounds,
		);
		expect(
			validateContractCandidate({
				...input,
				measurements: { ...measured, nodes: new Map() },
			}),
		).toEqual({ valid: false, reason: CandidateGeometryReason.Bounds });
		expect(
			validateContractCandidate({
				...input,
				candidate: {
					...candidate,
					sourceOrder: [...candidate.sourceOrder].reverse(),
				},
			}),
		).toEqual({ valid: false, reason: CandidateGeometryReason.Order });
		expect(
			validateContractCandidate({
				...input,
				candidate: {
					...candidate,
					targetOrder: [...candidate.targetOrder].reverse(),
				},
			}),
		).toEqual({ valid: false, reason: CandidateGeometryReason.Order });
		const firstSource = layout.elements.find(({ id }) => id === candidate.sourceOrder[0]);
		const secondSource = layout.elements.find(({ id }) => id === candidate.sourceOrder[1]);
		if (firstSource === undefined || secondSource === undefined)
			throw new Error('Selected source boxes missing');
		const alignedSecond = {
			...secondSource,
			bounds: {
				...secondSource.bounds,
				x: firstSource.bounds.x + firstSource.bounds.width / 2 - secondSource.bounds.width / 2,
				y: layout.height + 10,
			},
		};
		checkLayout(
			{
				...layout,
				height: layout.height + secondSource.bounds.height + 20,
				elements: layout.elements.map((element) => {
					if (element.id === alignedSecond.id) return alignedSecond;
					return element;
				}),
			},
			CandidateGeometryReason.Order,
		);
		checkLayout(
			{ ...layout, relations: layout.relations.slice(1) },
			CandidateGeometryReason.Relations,
		);
		const firstRoute = layout.relations[0];
		if (firstRoute === undefined) throw new Error('Selected route missing');
		checkLayout(
			{
				...layout,
				relations: [{ ...firstRoute, from: firstRoute.to }, ...layout.relations.slice(1)],
			},
			CandidateGeometryReason.Relations,
		);
		checkLayout(
			{
				...layout,
				relations: [{ ...firstRoute, points: [] }, ...layout.relations.slice(1)],
			},
			CandidateGeometryReason.Route,
		);
		const shifted = {
			...firstRoute,
			points: [{ x: 0, y: 0 }, ...firstRoute.points.slice(1)],
		};
		expect(
			validateContractCandidate({
				...input,
				layout: {
					...layout,
					relations: [shifted, ...layout.relations.slice(1)],
				},
			}),
		).toEqual({ valid: false, reason: CandidateGeometryReason.Attachment });
		const sourceBox = layout.elements.find(({ id }) => id === firstRoute.from)?.bounds;
		if (sourceBox === undefined) throw new Error('Selected source box missing');
		const first = firstRoute.points[0];
		const last = firstRoute.points.at(-1);
		if (first === undefined || last === undefined) throw new Error('Selected route points missing');
		checkLayout(
			{
				...layout,
				relations: [
					{
						...firstRoute,
						points: [...firstRoute.points.slice(0, -1), { x: last.x, y: last.y + 1 }],
					},
					...layout.relations.slice(1),
				],
			},
			CandidateGeometryReason.Attachment,
		);
		checkLayout(
			{
				...layout,
				relations: [{ ...firstRoute, points: [first, first] }, ...layout.relations.slice(1)],
			},
			CandidateGeometryReason.Route,
		);
		checkLayout(
			{
				...layout,
				relations: [
					{
						...firstRoute,
						points: [first, { x: first.x + 1, y: first.y + 1 }, ...firstRoute.points.slice(2)],
					},
					...layout.relations.slice(1),
				],
			},
			CandidateGeometryReason.Route,
		);
		checkLayout(
			{
				...layout,
				relations: [
					{
						...firstRoute,
						points: [first, { x: Number.NaN, y: first.y }, ...firstRoute.points.slice(2)],
					},
					...layout.relations.slice(1),
				],
			},
			CandidateGeometryReason.Route,
		);
		const insideY = sourceBox.y + sourceBox.height / 2;
		const throughSource = {
			...firstRoute,
			points: [first, { x: first.x, y: insideY }, { x: last.x, y: insideY }, last],
		};
		expect(
			validateContractCandidate({
				...input,
				layout: {
					...layout,
					relations: [throughSource, ...layout.relations.slice(1)],
				},
			}),
		).toEqual({ valid: false, reason: CandidateGeometryReason.Obstacle });
		const firstChoice = result.selection.choices[0];
		if (firstChoice === undefined) throw new Error('Selected face choice missing');
		expect(
			validateContractCandidate({
				...input,
				choices: [{ ...firstChoice, physicalPortGroups: [] }, ...result.selection.choices.slice(1)],
			}),
		).toEqual({ valid: false, reason: CandidateGeometryReason.Ports });
		expect(
			validateContractCandidate({
				...input,
				choices: [{ ...firstChoice, endpointId: 'ghost' }, ...result.selection.choices.slice(1)],
			}),
		).toEqual({ valid: false, reason: CandidateGeometryReason.Elements });
		expect(
			validateContractCandidate({
				...input,
				choices: [
					{
						...firstChoice,
						metricDemand: {
							...firstChoice.metricDemand,
							minimumCrossSize: 10_000,
						},
					},
					...result.selection.choices.slice(1),
				],
			}),
		).toEqual({ valid: false, reason: CandidateGeometryReason.MetricDemand });
	});

	it('keeps unsupported shapes and invalid measurements unknown', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const unknownShape = (document: LogicDocument) => {
			const prepared = graph(document);
			expect(
				buildAdjacentLayoutContract(prepared, topologicallyRank(prepared), measurements()),
			).toEqual({
				status: LayoutContractBuildStatus.Unknown,
				reason: LayoutContractUnknownReason.UnsupportedShape,
			});
		};
		expect(
			buildAdjacentLayoutContract(source, ranks, {
				...measurements(),
				nodes: new Map([['a', { width: 0, height: 60 }]]),
			}),
		).toEqual({
			status: LayoutContractBuildStatus.Unknown,
			reason: LayoutContractUnknownReason.InvalidMeasurements,
		});
		for (const nodes of [
			new Map([['a', { width: 80, height: 0 }]]),
			new Map([['a', { width: Number.NaN, height: 60 }]]),
			new Map<string, { width: number; height: number }>(),
		]) {
			expect(
				buildAdjacentLayoutContract(source, ranks, {
					...measurements(),
					nodes,
				}),
			).toMatchObject({
				status: LayoutContractBuildStatus.Unknown,
				reason: LayoutContractUnknownReason.InvalidMeasurements,
			});
		}
		const smaller = graph({
			...source.document,
			relations: source.document.relations.slice(0, 3),
		});
		expect(
			buildAdjacentLayoutContract(smaller, topologicallyRank(smaller), measurements()),
		).toEqual({
			status: LayoutContractBuildStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
		});
		unknownShape({
			...source.document,
			groups: [
				{
					id: 'G',
					kind: EndpointKind.Group,
					label: 'G',
					layoutOrder: orderKey('a5'),
				},
			],
		});
		unknownShape({
			...source.document,
			junctions: [
				{
					id: 'J',
					kind: EndpointKind.Junction,
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a5'),
				},
			],
		});
		unknownShape({
			...source.document,
			nodes: source.document.nodes.map((node) => {
				if (node.id === 'a') return { ...node, laneId: 'lane-1' };
				return node;
			}),
		});
		unknownShape({
			...source.document,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation: LaneOrientation.Parallel,
				growth: LaneGrowth.Auto,
				lanes: [],
			},
		});
		expect(
			buildAdjacentLayoutContract(source, { ...ranks, bands: [] }, measurements()),
		).toMatchObject({
			status: LayoutContractBuildStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
		});
		expect(
			buildAdjacentLayoutContract(
				source,
				{
					...ranks,
					bands: [
						['d', 'e'],
						['a', 'b'],
					],
				},
				measurements(),
			),
		).toMatchObject({
			status: LayoutContractBuildStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
		});
		const changedIncidence = graph({
			...source.document,
			relations: [...source.document.relations.slice(0, 3), { id: 'a-b', from: 'a', to: 'b' }],
		});
		expect(buildAdjacentLayoutContract(changedIncidence, ranks, measurements())).toMatchObject({
			status: LayoutContractBuildStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
		});
		const wrongEffective: LogicGraph = {
			...source,
			effectiveRelations: source.effectiveRelations.map((relation) => {
				if (relation.relationId === 'a-d') return { ...relation, targetIds: ['d', 'e'] };
				return relation;
			}),
		};
		expect(buildAdjacentLayoutContract(wrongEffective, ranks, measurements())).toMatchObject({
			status: LayoutContractBuildStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedCorridor,
		});
	});

	it('refuses a ready 2+2 contract through the exhaustive 3+1 resolver', () => {
		const source = graph(adjacentDocument(LayoutDirection.TopToBottom, '2+2', false));
		const ranks = topologicallyRank(source);
		const built = buildAdjacentLayoutContract(source, ranks, measurements());
		expect(built).toMatchObject({
			status: LayoutContractBuildStatus.Ready,
			contract: { shape: AdjacentContractShape.TwoByTwo },
		});
		if (built.status !== LayoutContractBuildStatus.Ready) return;
		expect(resolveAdjacentLayoutContract(source, ranks, measurements())).toEqual({
			status: LayoutContractResolutionStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
			contract: built.contract,
			evaluations: [],
		});
	});

	it('reports unsupported input through the resolver and rejects invalid search budgets', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		for (const maxBranches of [-1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() =>
				resolveAdjacentLayoutContract(source, ranks, measurements(), {
					maxBranches,
				}),
			).toThrow('Layout contract budget must be a non-negative safe integer');
		}
		expect(resolveAdjacentLayoutContract(source, { ...ranks, bands: [] }, measurements())).toEqual({
			status: LayoutContractResolutionStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
			evaluations: [],
		});
	});

	it('retains a validated incumbent when its search budget ends before all alternatives', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const complete = resolveAdjacentLayoutContract(source, ranks, measurements());
		expect(complete.status).toBe(LayoutContractResolutionStatus.Selected);
		if (complete.status !== LayoutContractResolutionStatus.Selected) return;
		const firstAccepted = complete.evaluations.findIndex(
			({ status }) => status === ContractBranchStatus.Accepted,
		);
		expect(firstAccepted).toBeGreaterThanOrEqual(0);
		const partial = resolveAdjacentLayoutContract(source, ranks, measurements(), {
			maxBranches: firstAccepted + 1,
		});
		expect(partial.status).toBe(LayoutContractResolutionStatus.Incomplete);
		if (partial.status !== LayoutContractResolutionStatus.Incomplete) return;
		expect(partial.incumbent?.layout).toEqual(
			layoutWithDedicatedEngine(source, ranks, measurements()),
		);
		expect(partial.exploredBranches).toBe(firstAccepted + 1);
	});

	it('reports a failed baseline as unknown without selecting a candidate', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		vi.spyOn(layoutEngine, 'layoutWithDedicatedEngine').mockImplementation(() => {
			throw new Error('Injected layout failure');
		});
		expect(
			resolveAdjacentLayoutContract(source, topologicallyRank(source), measurements()),
		).toMatchObject({
			status: LayoutContractResolutionStatus.Unknown,
			reason: 'baseline-failed',
			evaluations: [],
		});
	});

	it('reports unknown when every candidate materialization fails', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		vi.spyOn(candidateLayout, 'materializeContractCandidate').mockReturnValue(undefined);
		const result = resolveAdjacentLayoutContract(source, topologicallyRank(source), measurements());
		expect(result).toMatchObject({
			status: LayoutContractResolutionStatus.Unknown,
			reason: 'no-validated-candidate',
		});
		expect(result.evaluations.length).toBeGreaterThan(0);
		expect(
			result.evaluations.every(
				({ status }) => status === ContractBranchStatus.MaterializationFailed,
			),
		).toBe(true);
	});

	it('chooses the least metric demand and fewest inversions when multiple branches are admissible', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const baseline = layoutWithDedicatedEngine(source, ranks, measured);
		// Isolate resolver policy by admitting every symbolic branch through the geometry boundary.
		vi.spyOn(candidateLayout, 'materializeContractCandidate').mockReturnValue(baseline);
		vi.spyOn(geometryValidation, 'validateContractCandidate').mockReturnValue({
			valid: true,
		});
		const resolved = resolveAdjacentLayoutContract(source, ranks, measured);
		expect(resolved.status).toBe(LayoutContractResolutionStatus.Selected);
		if (resolved.status !== LayoutContractResolutionStatus.Selected) return;
		expect(resolved.evaluations.length).toBeGreaterThan(1);
		expect(
			resolved.evaluations.every(({ status }) => status === ContractBranchStatus.Accepted),
		).toBe(true);
		const costs = resolved.contract.candidates.map((candidate) => ({
			growth: candidate.faces.reduce((sum, face) => {
				const admissible = face.alternatives.filter(
					({ respectsRequiredSeparations }) => respectsRequiredSeparations,
				);
				return sum + Math.min(...admissible.map(({ metricDemand }) => metricDemand.growth));
			}, 0),
			inversions: candidate.conflicts.inversions.length,
		}));
		const leastGrowth = Math.min(...costs.map(({ growth }) => growth));
		const leastInversions = Math.min(
			...costs.filter(({ growth }) => growth === leastGrowth).map(({ inversions }) => inversions),
		);
		expect(resolved.selection).toMatchObject({
			totalGrowth: leastGrowth,
			forcedInversions: leastInversions,
			layout: baseline,
		});
	});

	it('prefers the fewest forced inversions when two admissible candidates tie on growth', () => {
		const source = graph(sparseDocument(LayoutDirection.TopToBottom));
		const ranks = topologicallyRank(source);
		const measured = measurements();
		const baseline = layoutWithDedicatedEngine(source, ranks, measured);
		vi.spyOn(candidateLayout, 'materializeContractCandidate').mockReturnValue(baseline);
		// Admit every branch but the zero-growth ones, so the least admitted growth is shared by
		// branches of two distinct candidates that differ in their forced inversions.
		vi.spyOn(geometryValidation, 'validateContractCandidate').mockImplementation(({ choices }) => {
			const growth = choices.reduce((sum, choice) => sum + choice.metricDemand.growth, 0);
			if (growth === 0) return { valid: false, reason: CandidateGeometryReason.MetricDemand };
			return { valid: true };
		});
		const resolved = resolveAdjacentLayoutContract(source, ranks, measured);
		expect(resolved.status).toBe(LayoutContractResolutionStatus.Selected);
		if (resolved.status !== LayoutContractResolutionStatus.Selected) return;
		expect(resolved.selection.totalGrowth).toBe(16);
		expect(resolved.selection.forcedInversions).toBe(0);
		expect(
			resolved.evaluations.filter(({ status }) => status === ContractBranchStatus.Accepted).length,
		).toBeGreaterThan(2);
	});
});

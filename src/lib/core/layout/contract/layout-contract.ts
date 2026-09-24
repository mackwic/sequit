import { compareCanonicalStrings } from '../../canonical-string';
import { defined, EndpointKind, LayoutDirection } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import { type LayoutMeasurements, RoutingPortRole, type Size } from '../layout-types';
import { enumerateRankOrders, permutations, type RankDomain } from '../rank-order';
import type { ConditionalPortConflicts } from '../routing/conditional-port-conflicts';
import { threeIncidenceFaceCapacity } from '../routing/face-capacity';
import {
	type GraphCorridorCandidate,
	graphCorridorConflicts,
	GraphCorridorStatus,
} from '../routing/graph-corridor-conflicts';
import type { FaceCapacityMetricDemand } from './metric-demand';

export enum LayoutContractBuildStatus {
	Ready = 'ready',
	Unknown = 'unknown',
}

export enum LayoutContractUnknownReason {
	UnsupportedShape = 'unsupported-shape',
	UnsupportedCorridor = 'unsupported-corridor',
	InvalidMeasurements = 'invalid-measurements',
}

export interface PortAlternative {
	readonly portGroups: readonly (readonly string[])[];
	readonly physicalOrders: readonly (readonly (readonly string[])[])[];
	readonly respectsRequiredSeparations: boolean;
	readonly metricDemand: FaceCapacityMetricDemand;
}

interface ContractFace {
	readonly endpointId: string;
	readonly alternatives: readonly PortAlternative[];
}

export interface LayoutContractCandidate extends GraphCorridorCandidate {
	readonly id: string;
	readonly conflicts: ConditionalPortConflicts;
	readonly faces: readonly ContractFace[];
	/** The bounded materializer allocates one outgoing port per relation. */
	readonly sourceFaceDemands: readonly FaceCapacityMetricDemand<RoutingPortRole.Outgoing>[];
}

export enum AdjacentContractShape {
	ThreePlusOne = 'adjacent-3+1',
	TwoByTwo = 'adjacent-2+2',
}

/** Coordinate-free alternatives for one complete, adjacent node corridor. */
export interface LayoutContract {
	readonly shape: AdjacentContractShape;
	readonly sourceIds: readonly string[];
	readonly targetIds: readonly string[];
	readonly candidates: readonly LayoutContractCandidate[];
}

interface ReadyLayoutContract {
	readonly status: LayoutContractBuildStatus.Ready;
	readonly contract: LayoutContract;
}

interface UnknownLayoutContract {
	readonly status: LayoutContractBuildStatus.Unknown;
	readonly reason: LayoutContractUnknownReason;
}

export type LayoutContractBuild = ReadyLayoutContract | UnknownLayoutContract;

/** `adjacentShape` admits exactly three sources and two targets, so the product is 3!·2!. */
const ADJACENT_RANK_ORDER_BUDGET = 12;

function physicalOrders(
	groups: readonly (readonly string[])[],
): readonly (readonly (readonly string[])[])[] {
	return permutations(groups);
}

function validMeasurements(ids: readonly string[], measurements: LayoutMeasurements): boolean {
	return ids.every((id) => validNodeSize(measurements.nodes.get(id)));
}

function validNodeSize(size: Size | undefined): boolean {
	if (size === undefined) return false;
	if (!Number.isFinite(size.width) || size.width <= 0) return false;
	return Number.isFinite(size.height) && size.height > 0;
}

function adjacentShape(
	graph: LogicGraph,
	ranks: TopologicalRanks,
): AdjacentContractShape | undefined {
	if (graph.document.presentation !== undefined) return undefined;
	if ([...graph.endpointsById.values()].some(({ kind }) => kind !== EndpointKind.Node))
		return undefined;
	if (
		graph.document.nodes.some(
			({ laneId, groupId }) => laneId !== undefined || groupId !== undefined,
		)
	)
		return undefined;
	if (ranks.bands.length !== 2) return undefined;
	const targets = ranks.bands[0];
	const sources = ranks.bands[1];
	if (targets?.length !== 2 || sources?.length !== 3) return undefined;
	if (graph.relations.length !== 4) return undefined;
	const sourceIds = new Set(sources);
	const targetIds = new Set(targets);
	if (
		graph.relations.some(
			({ relation }) => !sourceIds.has(relation.from) || !targetIds.has(relation.to),
		)
	)
		return undefined;
	const degrees = targets.map(
		(id) => graph.relations.filter(({ relation }) => relation.to === id).length,
	);
	if (degrees.includes(3) && degrees.includes(1)) return AdjacentContractShape.ThreePlusOne;
	if (!degrees.every((degree) => degree === 2)) return undefined;
	const pairs = new Set(
		graph.relations.map(({ relation }) => JSON.stringify([relation.from, relation.to])),
	);
	if (pairs.size !== graph.relations.length) return undefined;
	return AdjacentContractShape.TwoByTwo;
}

function intrinsicCrossSize(size: Size, direction: LayoutDirection): number {
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop)
		return size.width;
	return size.height;
}

function sourceFaceDemands(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	sourceIds: readonly string[],
): readonly FaceCapacityMetricDemand<RoutingPortRole.Outgoing>[] {
	return sourceIds.map((endpointId) => {
		const portCount = graph.relations.filter(({ relation }) => relation.from === endpointId).length;
		const intrinsic = intrinsicCrossSize(
			defined(measurements.nodes.get(endpointId)),
			graph.document.layout.direction,
		);
		const faceInsets = 2 * PORT_INSET;
		const portSpan = (portCount - 1) * PORT_SPACING;
		const minimumCrossSize = Math.max(intrinsic, faceInsets + portSpan);
		return {
			endpointId,
			role: RoutingPortRole.Outgoing,
			portCount,
			minimumCrossSize,
			growth: minimumCrossSize - intrinsic,
		};
	});
}

function faceContract(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	conflicts: ConditionalPortConflicts,
	targetId: string,
): ContractFace {
	const incidences = graph.relations
		.filter(({ relation }) => relation.to === targetId)
		.map(({ relation }) => ({ relationId: relation.id, oppositeEndpointId: relation.from }));
	const size = defined(measurements.nodes.get(targetId));
	const vertical =
		graph.document.layout.direction === LayoutDirection.TopToBottom ||
		graph.document.layout.direction === LayoutDirection.BottomToTop;
	let intrinsicCrossSize = size.height;
	if (vertical) intrinsicCrossSize = size.width;
	if (incidences.length === 1) {
		const minimumCrossSize = Math.max(intrinsicCrossSize, 2 * PORT_INSET);
		return {
			endpointId: targetId,
			alternatives: [
				{
					portGroups: [[defined(incidences[0]).relationId]],
					physicalOrders: [[[defined(incidences[0]).relationId]]],
					respectsRequiredSeparations: true,
					metricDemand: {
						endpointId: targetId,
						role: RoutingPortRole.Incoming,
						portCount: 1,
						minimumCrossSize,
						growth: minimumCrossSize - intrinsicCrossSize,
					},
				},
			],
		};
	}
	const requiredSeparations = conflicts.requiredSeparations
		.filter(({ endpointId }) => endpointId === targetId)
		.map(({ firstRelationId, secondRelationId }) => ({ firstRelationId, secondRelationId }));
	if (incidences.length === 2) {
		const relationIds = incidences
			.map(({ relationId }) => relationId)
			.sort(compareCanonicalStrings);
		const shared = [relationIds];
		const separate = relationIds.map((id) => [id]);
		return {
			endpointId: targetId,
			alternatives: [shared, separate].map((portGroups) => {
				const faceInsets = 2 * PORT_INSET;
				const portSpan = (portGroups.length - 1) * PORT_SPACING;
				const minimumCrossSize = Math.max(intrinsicCrossSize, faceInsets + portSpan);
				return {
					portGroups,
					physicalOrders: physicalOrders(portGroups),
					respectsRequiredSeparations: portGroups.length === 2 || requiredSeparations.length === 0,
					metricDemand: {
						endpointId: targetId,
						role: RoutingPortRole.Incoming,
						portCount: portGroups.length,
						minimumCrossSize,
						growth: minimumCrossSize - intrinsicCrossSize,
					},
				};
			}),
		};
	}
	const face = threeIncidenceFaceCapacity({
		endpointId: targetId,
		role: 'incoming',
		incidences,
		intrinsicCrossSize,
		inset: PORT_INSET,
		spacing: PORT_SPACING,
		requiredSeparations,
	});
	return {
		endpointId: targetId,
		alternatives: face.alternatives.map((alternative) => ({
			portGroups: alternative.portGroups,
			physicalOrders: physicalOrders(alternative.portGroups),
			respectsRequiredSeparations: alternative.respectsRequiredSeparations,
			metricDemand: {
				endpointId: targetId,
				role: RoutingPortRole.Incoming,
				portCount: alternative.portGroups.length,
				minimumCrossSize: alternative.metricDemand.minimumCrossSize,
				growth: alternative.metricDemand.growth,
			},
		})),
	};
}

/** Derive a small contract from validated source graph, ranks, and intrinsic node sizes. */
export function buildAdjacentLayoutContract(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
): LayoutContractBuild {
	const shape = adjacentShape(graph, ranks);
	if (shape === undefined)
		return {
			status: LayoutContractBuildStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
		};
	const sourceIds = [...defined(ranks.bands[1])].sort(compareCanonicalStrings);
	const targetIds = [...defined(ranks.bands[0])].sort(compareCanonicalStrings);
	if (!validMeasurements([...sourceIds, ...targetIds], measurements))
		return {
			status: LayoutContractBuildStatus.Unknown,
			reason: LayoutContractUnknownReason.InvalidMeasurements,
		};
	const outgoingDemands = sourceFaceDemands(graph, measurements, sourceIds);
	const candidates: LayoutContractCandidate[] = [];
	const domain: RankDomain = { bands: [sourceIds, targetIds] };
	for (const rankOrder of enumerateRankOrders(domain, ADJACENT_RANK_ORDER_BUDGET)) {
		const sourceOrder = defined(rankOrder[0]);
		const targetOrder = defined(rankOrder[1]);
		const order: GraphCorridorCandidate = {
			sourceRank: 1,
			targetRank: 0,
			sourceOrder,
			targetOrder,
			passage: 'monotone-adjacent-corridor',
		};
		const deduction = graphCorridorConflicts(graph, ranks, order);
		if (deduction.status === GraphCorridorStatus.Unknown)
			return {
				status: LayoutContractBuildStatus.Unknown,
				reason: LayoutContractUnknownReason.UnsupportedCorridor,
			};
		const faces = targetOrder.map((targetId) =>
			faceContract(graph, measurements, deduction.conflicts, targetId),
		);
		candidates.push({
			...order,
			id: JSON.stringify([sourceOrder, targetOrder]),
			conflicts: deduction.conflicts,
			faces,
			sourceFaceDemands: outgoingDemands,
		});
	}
	return {
		status: LayoutContractBuildStatus.Ready,
		contract: { shape, sourceIds, targetIds, candidates },
	};
}

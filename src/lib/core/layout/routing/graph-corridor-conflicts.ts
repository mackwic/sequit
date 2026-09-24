import { EndpointKind } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import {
	type ConditionalPortConflictInput,
	type ConditionalPortConflicts,
	conditionalPortConflicts,
} from './conditional-port-conflicts';

export enum GraphCorridorStatus {
	Deduced = 'deduced',
	Unknown = 'unknown',
}

export enum GraphCorridorUnknownReason {
	OtherPassage = 'other-passage',
	NonAdjacentRanks = 'non-adjacent-ranks',
	IncompleteCandidateOrder = 'incomplete-candidate-order',
	UnsupportedPresentation = 'unsupported-presentation',
	GroupOrJunction = 'group-or-junction',
	ProjectedRelation = 'projected-relation',
	ExternalIncidence = 'external-incidence',
	EmptyCorridor = 'empty-corridor',
}

export interface GraphCorridorCandidate {
	readonly sourceRank: number;
	readonly targetRank: number;
	/** Complete candidate orders for the two topological rank bands. */
	readonly sourceOrder: readonly string[];
	readonly targetOrder: readonly string[];
	readonly passage: ConditionalPortConflictInput['passage'];
}

interface UnknownGraphCorridorConflicts {
	readonly status: GraphCorridorStatus.Unknown;
	readonly reason: GraphCorridorUnknownReason;
}

interface DeducedGraphCorridorConflicts {
	readonly status: GraphCorridorStatus.Deduced;
	readonly conflicts: ConditionalPortConflicts;
}

export type GraphCorridorConflicts = UnknownGraphCorridorConflicts | DeducedGraphCorridorConflicts;

function unknown(reason: GraphCorridorUnknownReason): GraphCorridorConflicts {
	return { status: GraphCorridorStatus.Unknown, reason };
}

function matchesBand(
	order: readonly string[],
	band: readonly string[] | undefined,
	rank: number,
	ranks: TopologicalRanks,
): boolean {
	if (band === undefined) return false;
	if (order.length !== band.length) return false;
	const expected = new Set(band);
	return (
		new Set(order).size === order.length &&
		order.every((id) => expected.has(id) && ranks.byEndpointId.get(id) === rank)
	);
}

function hasProjectedRelations(graph: LogicGraph): boolean {
	if (graph.effectiveRelations.length !== graph.relations.length) return true;
	const directById = new Map(graph.relations.map(({ relation }) => [relation.id, relation]));
	if (directById.size !== graph.relations.length) return true;
	return graph.effectiveRelations.some((effective) => {
		const direct = directById.get(effective.relationId);
		if (direct === undefined) return true;
		if (effective.sourceIds.length !== 1 || effective.targetIds.length !== 1) return true;
		return effective.sourceIds[0] !== direct.from || effective.targetIds[0] !== direct.to;
	});
}

/** A conditional, coordinate-free deduction for one complete adjacent node-only corridor. */
export function graphCorridorConflicts(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	candidate: GraphCorridorCandidate,
): GraphCorridorConflicts {
	const { sourceRank, targetRank, sourceOrder, targetOrder } = candidate;
	if (candidate.passage !== 'monotone-adjacent-corridor')
		return unknown(GraphCorridorUnknownReason.OtherPassage);
	if (!Number.isInteger(targetRank) || targetRank < 0)
		return unknown(GraphCorridorUnknownReason.NonAdjacentRanks);
	if (sourceRank !== targetRank + 1) return unknown(GraphCorridorUnknownReason.NonAdjacentRanks);
	if (graph.document.presentation !== undefined)
		return unknown(GraphCorridorUnknownReason.UnsupportedPresentation);
	if ([...graph.endpointsById.values()].some(({ kind }) => kind !== EndpointKind.Node))
		return unknown(GraphCorridorUnknownReason.GroupOrJunction);
	if (hasProjectedRelations(graph)) return unknown(GraphCorridorUnknownReason.ProjectedRelation);
	if (
		!matchesBand(sourceOrder, ranks.bands[sourceRank], sourceRank, ranks) ||
		!matchesBand(targetOrder, ranks.bands[targetRank], targetRank, ranks)
	)
		return unknown(GraphCorridorUnknownReason.IncompleteCandidateOrder);

	const sources = new Set(sourceOrder);
	const targets = new Set(targetOrder);
	const relations: ConditionalPortConflictInput['relations'][number][] = [];
	for (const { relation } of graph.relations) {
		const touchesBand =
			sources.has(relation.from) ||
			targets.has(relation.from) ||
			sources.has(relation.to) ||
			targets.has(relation.to);
		if (!touchesBand) continue;
		if (!sources.has(relation.from) || !targets.has(relation.to))
			return unknown(GraphCorridorUnknownReason.ExternalIncidence);
		relations.push(relation);
	}
	if (relations.length === 0) return unknown(GraphCorridorUnknownReason.EmptyCorridor);
	return {
		status: GraphCorridorStatus.Deduced,
		conflicts: conditionalPortConflicts({
			sourceRank,
			targetRank,
			sourceOrder,
			targetOrder,
			relations,
			passage: candidate.passage,
		}),
	};
}

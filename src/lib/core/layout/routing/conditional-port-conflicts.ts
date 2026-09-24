import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';

interface OrderedCorridorRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
}

enum CorridorPassage {
	MonotoneAdjacent = 'monotone-adjacent-corridor',
	Other = 'other-passage',
}

enum ConflictStatus {
	Deduced = 'deduced',
	Unknown = 'unknown',
}

enum UnknownReason {
	OtherPassage = 'other-passage',
	NonAdjacentRanks = 'non-adjacent-ranks',
}

export interface ConditionalPortConflictInput {
	readonly sourceRank: number;
	readonly targetRank: number;
	readonly sourceOrder: readonly string[];
	readonly targetOrder: readonly string[];
	readonly relations: readonly OrderedCorridorRelation[];
	/** A route outside this corridor needs its own crossing and sharing analysis. */
	readonly passage: `${CorridorPassage}`;
}

interface RelationPair {
	readonly firstRelationId: string;
	readonly secondRelationId: string;
}

interface FaceSeparation extends RelationPair {
	readonly endpointId: string;
}

export interface ConditionalPortConflicts {
	/** Unknown means that empty arrays do not assert that sharing is permitted. */
	readonly status: `${ConflictStatus}`;
	readonly reason?: `${UnknownReason}`;
	readonly inversions: readonly RelationPair[];
	readonly forcedCrossed: readonly string[];
	readonly requiredSeparations: readonly FaceSeparation[];
}

function comparePairs(a: RelationPair, b: RelationPair): number {
	return (
		compareCanonicalStrings(a.firstRelationId, b.firstRelationId) ||
		compareCanonicalStrings(a.secondRelationId, b.secondRelationId)
	);
}

function indexedOrder(ids: readonly string[], name: string): ReadonlyMap<string, number> {
	const index = new Map(ids.map((id, position) => [id, position]));
	if (index.size !== ids.length) throw new Error(`Duplicate ${name} endpoint`);
	return index;
}

function validate(input: ConditionalPortConflictInput): {
	readonly sources: ReadonlyMap<string, number>;
	readonly targets: ReadonlyMap<string, number>;
} {
	if (![input.sourceRank, input.targetRank].every((rank) => Number.isInteger(rank) && rank >= 0))
		throw new Error('Corridor ranks must be non-negative integers');
	const sources = indexedOrder(input.sourceOrder, 'source');
	const targets = indexedOrder(input.targetOrder, 'target');
	if ([...sources.keys()].some((id) => targets.has(id)))
		throw new Error('Corridor rows must have distinct endpoints');
	const relationIds = new Set<string>();
	for (const relation of input.relations) {
		if (relationIds.has(relation.id)) throw new Error(`Duplicate relation ${relation.id}`);
		relationIds.add(relation.id);
		if (!sources.has(relation.from) || !targets.has(relation.to))
			throw new Error(`Relation ${relation.id} is outside the ordered corridor rows`);
	}
	return { sources, targets };
}

function areInverted(
	first: OrderedCorridorRelation,
	second: OrderedCorridorRelation,
	sources: ReadonlyMap<string, number>,
	targets: ReadonlyMap<string, number>,
): boolean {
	if (first.from === second.from || first.to === second.to) return false;
	const sourceDifference = defined(sources.get(first.from)) - defined(sources.get(second.from));
	const targetDifference = defined(targets.get(first.to)) - defined(targets.get(second.to));
	return sourceDifference * targetDifference < 0;
}

function findInversions(
	relations: readonly OrderedCorridorRelation[],
	sources: ReadonlyMap<string, number>,
	targets: ReadonlyMap<string, number>,
): { readonly inversions: RelationPair[]; readonly crossed: ReadonlySet<string> } {
	const inversions: RelationPair[] = [];
	const crossed = new Set<string>();
	for (const [index, first] of relations.entries()) {
		for (const second of relations.slice(index + 1)) {
			if (!areInverted(first, second, sources, targets)) continue;
			inversions.push({ firstRelationId: first.id, secondRelationId: second.id });
			crossed.add(first.id);
			crossed.add(second.id);
		}
	}
	return { inversions, crossed };
}

function appendTargetSeparations(
	endpointId: string,
	incoming: readonly OrderedCorridorRelation[],
	crossed: ReadonlySet<string>,
	separations: FaceSeparation[],
): void {
	for (const [index, first] of incoming.entries()) {
		for (const second of incoming.slice(index + 1)) {
			if (!crossed.has(first.id) && !crossed.has(second.id)) continue;
			separations.push({
				endpointId,
				firstRelationId: first.id,
				secondRelationId: second.id,
			});
		}
	}
}

function requiredSeparations(
	relations: readonly OrderedCorridorRelation[],
	crossed: ReadonlySet<string>,
): FaceSeparation[] {
	const byTarget = new Map<string, OrderedCorridorRelation[]>();
	for (const relation of relations) {
		const incoming = byTarget.get(relation.to) ?? [];
		incoming.push(relation);
		byTarget.set(relation.to, incoming);
	}
	const separations: FaceSeparation[] = [];
	for (const [endpointId, incoming] of byTarget)
		appendTargetSeparations(endpointId, incoming, crossed, separations);
	return separations;
}

/**
 * An order inversion forces a crossing only for a monotone adjacent rank corridor.
 * A crossed arrival cannot share its target port under the current routing policy.
 * Source-face sharing remains undecided because initial trunks may be shared.
 */
export function conditionalPortConflicts(
	input: ConditionalPortConflictInput,
): ConditionalPortConflicts {
	const { sources, targets } = validate(input);
	if (input.passage !== 'monotone-adjacent-corridor')
		return {
			status: ConflictStatus.Unknown,
			reason: UnknownReason.OtherPassage,
			inversions: [],
			forcedCrossed: [],
			requiredSeparations: [],
		};
	if (input.sourceRank !== input.targetRank + 1)
		return {
			status: ConflictStatus.Unknown,
			reason: UnknownReason.NonAdjacentRanks,
			inversions: [],
			forcedCrossed: [],
			requiredSeparations: [],
		};

	const relations = [...input.relations].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	const { inversions, crossed } = findInversions(relations, sources, targets);
	return {
		status: ConflictStatus.Deduced,
		inversions: inversions.sort(comparePairs),
		forcedCrossed: [...crossed].sort(compareCanonicalStrings),
		requiredSeparations: requiredSeparations(relations, crossed).sort(
			(a, b) => compareCanonicalStrings(a.endpointId, b.endpointId) || comparePairs(a, b),
		),
	};
}

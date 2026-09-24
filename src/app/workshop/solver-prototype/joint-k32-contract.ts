import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import { defined } from '../../../lib/core/document/logic-document';
import {
	type ConditionalPortConflictInput,
	conditionalPortConflicts,
} from './conditional-port-conflicts';
import { threeIncidenceFaceCapacity } from './face-capacity';

type Relation = ConditionalPortConflictInput['relations'][number];
type Passage = ConditionalPortConflictInput['passage'];
type Conflicts = ReturnType<typeof conditionalPortConflicts>;
type FaceContract = ReturnType<typeof threeIncidenceFaceCapacity>;
type FaceAlternative = FaceContract['alternatives'][number];

interface JointK32Candidate {
	readonly id: string;
	readonly sourceRank: number;
	readonly targetRank: number;
	readonly sourceOrder: readonly string[];
	readonly targetOrder: readonly string[];
	readonly passage: Passage;
}

interface FaceMetrics {
	readonly endpointId: string;
	readonly intrinsicCrossSize: number;
	readonly inset: number;
	readonly spacing: number;
}

/** Complete K3,2 or its 3+1 sparse witness; no box or route coordinates enter this IR. */
export interface JointK32Input {
	readonly sourceIds: readonly string[];
	readonly targetIds: readonly string[];
	readonly relations: readonly Relation[];
	readonly faceMetrics: readonly FaceMetrics[];
	readonly candidates: readonly JointK32Candidate[];
}

interface OrderedFaceAlternative {
	readonly partitionIndex: number;
	readonly portGroups: FaceAlternative['portGroups'];
	readonly respectsRequiredSeparations: boolean;
	readonly minimumCrossSize: number;
	readonly growth: number;
	/** Physical tangential order is a decision, not inferred from relation IDs. */
	readonly physicalOrders: readonly (readonly (readonly string[])[])[];
}

interface AnalyzedFace {
	readonly endpointId: string;
	readonly requiredSeparations: FaceContract['requiredSeparations'];
	readonly alternatives: readonly OrderedFaceAlternative[];
}

interface JointK32CandidateAnalysis {
	readonly candidate: JointK32Candidate;
	readonly conflicts: Conflicts;
	readonly status: 'deduced' | 'unknown';
	readonly faces: readonly AnalyzedFace[];
}

interface BranchFace {
	readonly endpointId: string;
	readonly partitionIndex: number;
	readonly physicalOrderIndex: number;
	readonly portGroups: OrderedFaceAlternative['portGroups'];
	readonly physicalPortGroups: readonly (readonly string[])[];
	readonly minimumCrossSize: number;
	readonly growth: number;
}

interface JointK32Branch {
	readonly id: string;
	readonly candidateId: string;
	readonly faces: readonly BranchFace[];
	/** Strict order inversions are a lower bound, not the final physical crossing count. */
	readonly forcedOrderInversionCount: number;
	readonly totalGrowth: number;
	readonly maximumCrossSize: number;
	/** This status does not claim a geometric route exists. */
	readonly status: 'symbolic-admissible' | 'not-explored';
}

interface JointK32TraceEntry {
	readonly candidateId: string;
	readonly kind:
		| 'conflicts'
		| 'unknown-passage'
		| 'face-partition-rejected'
		| 'branch'
		| 'incumbent'
		| 'budget-exhausted';
	readonly detail: string;
}

export interface JointK32Result {
	readonly analyses: readonly JointK32CandidateAnalysis[];
	readonly branches: readonly JointK32Branch[];
	readonly trace: readonly JointK32TraceEntry[];
	readonly incumbent: JointK32Branch | undefined;
	readonly exploredBranches: number;
	readonly budget: number;
	/** Complete only for the generated, deduced symbolic branches; unknown passages remain open. */
	readonly searchStatus: 'complete' | 'incomplete';
	/** The corridor witness cannot establish global geometric feasibility or infeasibility. */
	readonly globalStatus: 'undetermined';
}

function sortedUnique(
	ids: readonly string[],
	expectedCount: number,
	label: string,
): readonly string[] {
	if (ids.length !== expectedCount || new Set(ids).size !== expectedCount)
		throw new Error(`K3,2 needs ${expectedCount} distinct ${label}.`);
	return [...ids].sort(compareCanonicalStrings);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return JSON.stringify([...left].sort(compareCanonicalStrings)) === JSON.stringify(right);
}

function normalizedInput(input: JointK32Input): JointK32Input {
	const sourceIds = sortedUnique(input.sourceIds, 3, 'sources');
	const targetIds = sortedUnique(input.targetIds, 2, 'targets');
	if (sourceIds.some((id) => targetIds.includes(id)))
		throw new Error('K3,2 source and target IDs must be distinct.');
	if (
		![4, 6].includes(input.relations.length) ||
		new Set(input.relations.map(({ id }) => id)).size !== input.relations.length
	)
		throw new Error('The joint witness needs four or six uniquely identified relations.');
	const relationPairs = new Set<string>();
	for (const relation of input.relations) {
		if (!sourceIds.includes(relation.from) || !targetIds.includes(relation.to))
			throw new Error(`Relation ${relation.id} is outside K3,2.`);
		relationPairs.add(JSON.stringify([relation.from, relation.to]));
	}
	if (relationPairs.size !== input.relations.length)
		throw new Error('The joint witness cannot repeat a source-target pair.');
	const degrees = targetIds.map((id) => input.relations.filter(({ to }) => to === id).length);
	const hasCompleteDegrees =
		input.relations.length === 6 && degrees.every((degree) => degree === 3);
	const hasSparseDegrees =
		input.relations.length === 4 && JSON.stringify([...degrees].sort()) === '[1,3]';
	if (!hasCompleteDegrees && !hasSparseDegrees)
		throw new Error('The joint witness needs target indegrees 3+3 or 3+1.');
	if (
		input.faceMetrics.length !== 2 ||
		!sameIds(
			input.faceMetrics.map(({ endpointId }) => endpointId),
			targetIds,
		)
	)
		throw new Error('K3,2 needs one face metric set per target.');
	for (const metrics of input.faceMetrics) {
		if (
			!Number.isFinite(metrics.intrinsicCrossSize) ||
			metrics.intrinsicCrossSize <= 0 ||
			!Number.isFinite(metrics.inset) ||
			metrics.inset < 0 ||
			!Number.isFinite(metrics.spacing) ||
			metrics.spacing <= 0
		)
			throw new Error('Joint face metrics need positive size/spacing and a non-negative inset.');
	}
	if (new Set(input.candidates.map(({ id }) => id)).size !== input.candidates.length)
		throw new Error('K3,2 candidate IDs must be unique.');
	for (const candidate of input.candidates) {
		if (!sameIds(candidate.sourceOrder, sourceIds) || !sameIds(candidate.targetOrder, targetIds))
			throw new Error(`Candidate ${candidate.id} must order each K3,2 endpoint once.`);
	}
	return {
		...input,
		sourceIds,
		targetIds,
		relations: [...input.relations].sort((a, b) => compareCanonicalStrings(a.id, b.id)),
		faceMetrics: [...input.faceMetrics].sort((a, b) =>
			compareCanonicalStrings(a.endpointId, b.endpointId),
		),
		candidates: [...input.candidates].sort((a, b) => compareCanonicalStrings(a.id, b.id)),
	};
}

function physicalOrders(
	groups: FaceAlternative['portGroups'],
): readonly (readonly (readonly string[])[])[] {
	if (groups.length === 1) return [[...groups]];
	return groups.flatMap((group, index) =>
		physicalOrders(groups.filter((_, otherIndex) => otherIndex !== index)).map((rest) => [
			group,
			...rest,
		]),
	);
}

function analyzeCandidate(
	input: JointK32Input,
	candidate: JointK32Candidate,
): JointK32CandidateAnalysis {
	const conflicts = conditionalPortConflicts({
		sourceRank: candidate.sourceRank,
		targetRank: candidate.targetRank,
		sourceOrder: candidate.sourceOrder,
		targetOrder: candidate.targetOrder,
		relations: input.relations,
		passage: candidate.passage,
	});
	if (conflicts.status === 'unknown') return { candidate, conflicts, status: 'unknown', faces: [] };
	const faces = input.faceMetrics.map((metrics): AnalyzedFace => {
		const incidences = input.relations
			.filter(({ to }) => to === metrics.endpointId)
			.map(({ id, from }) => ({ relationId: id, oppositeEndpointId: from }));
		const requiredSeparations = conflicts.requiredSeparations
			.filter(({ endpointId }) => endpointId === metrics.endpointId)
			.map(({ firstRelationId, secondRelationId }) => ({ firstRelationId, secondRelationId }));
		const faceInput = {
			...metrics,
			role: 'incoming' as const,
			incidences,
			requiredSeparations,
		};
		let face: FaceContract;
		if (incidences.length === 3) face = threeIncidenceFaceCapacity(faceInput);
		else {
			const minimumCrossSize = Math.max(metrics.intrinsicCrossSize, 2 * metrics.inset);
			face = {
				endpointId: metrics.endpointId,
				role: 'incoming',
				incidences,
				requiredSeparations,
				alternatives: [
					{
						portGroups: [[defined(incidences[0]).relationId]],
						respectsRequiredSeparations: true,
						metricDemand: {
							minimumCrossSize,
							growth: minimumCrossSize - metrics.intrinsicCrossSize,
						},
					},
				],
			};
		}
		return {
			endpointId: metrics.endpointId,
			requiredSeparations: face.requiredSeparations,
			alternatives: face.alternatives.map((alternative, partitionIndex) => {
				let orders: readonly (readonly (readonly string[])[])[] = [];
				if (alternative.respectsRequiredSeparations)
					orders = physicalOrders(alternative.portGroups);
				return {
					partitionIndex,
					portGroups: alternative.portGroups,
					respectsRequiredSeparations: alternative.respectsRequiredSeparations,
					minimumCrossSize: alternative.metricDemand.minimumCrossSize,
					growth: alternative.metricDemand.growth,
					physicalOrders: orders,
				};
			}),
		};
	});
	return { candidate, conflicts, status: 'deduced', faces };
}

function candidateBranches(analysis: JointK32CandidateAnalysis): readonly JointK32Branch[] {
	const firstFace = defined(analysis.faces[0], 'A deduced candidate needs its first face.');
	const secondFace = defined(analysis.faces[1], 'A deduced candidate needs its second face.');
	const branches: JointK32Branch[] = [];
	for (const first of firstFace.alternatives) {
		for (const second of secondFace.alternatives) {
			for (const [firstOrderIndex, firstOrder] of first.physicalOrders.entries()) {
				for (const [secondOrderIndex, secondOrder] of second.physicalOrders.entries()) {
					const faces: readonly BranchFace[] = [
						{
							endpointId: firstFace.endpointId,
							partitionIndex: first.partitionIndex,
							physicalOrderIndex: firstOrderIndex,
							portGroups: first.portGroups,
							physicalPortGroups: firstOrder,
							minimumCrossSize: first.minimumCrossSize,
							growth: first.growth,
						},
						{
							endpointId: secondFace.endpointId,
							partitionIndex: second.partitionIndex,
							physicalOrderIndex: secondOrderIndex,
							portGroups: second.portGroups,
							physicalPortGroups: secondOrder,
							minimumCrossSize: second.minimumCrossSize,
							growth: second.growth,
						},
					];
					branches.push({
						id: `${analysis.candidate.id}/${firstFace.endpointId}-${first.partitionIndex}-${firstOrderIndex}/${secondFace.endpointId}-${second.partitionIndex}-${secondOrderIndex}`,
						candidateId: analysis.candidate.id,
						faces,
						forcedOrderInversionCount: analysis.conflicts.inversions.length,
						totalGrowth: first.growth + second.growth,
						maximumCrossSize: Math.max(first.minimumCrossSize, second.minimumCrossSize),
						status: 'not-explored',
					});
				}
			}
		}
	}
	return branches;
}

function better(left: JointK32Branch, right: JointK32Branch): boolean {
	return (
		(left.totalGrowth - right.totalGrowth ||
			left.maximumCrossSize - right.maximumCrossSize ||
			left.forcedOrderInversionCount - right.forcedOrderInversionCount ||
			compareCanonicalStrings(left.id, right.id)) < 0
	);
}

/** Enumerates corridor contracts. Admissibility here is symbolic only, pending route materialization. */
export function solveJointK32Contract(
	input: JointK32Input,
	options: { readonly maxBranches?: number } = {},
): JointK32Result {
	const normalized = normalizedInput(input);
	const budget = options.maxBranches ?? Number.MAX_SAFE_INTEGER;
	if (!Number.isSafeInteger(budget) || budget < 0)
		throw new Error('K3,2 branch budget must be a non-negative safe integer.');
	const analyses = normalized.candidates.map((candidate) =>
		analyzeCandidate(normalized, candidate),
	);
	const trace: JointK32TraceEntry[] = [];
	const branches: JointK32Branch[] = [];
	let incumbent: JointK32Branch | undefined;
	let exploredBranches = 0;
	for (const analysis of analyses) {
		const candidateId = analysis.candidate.id;
		if (analysis.status === 'unknown') {
			trace.push({
				candidateId,
				kind: 'unknown-passage',
				detail: analysis.conflicts.reason ?? 'unresolved',
			});
			continue;
		}
		trace.push({
			candidateId,
			kind: 'conflicts',
			detail: `${analysis.conflicts.inversions.length} inversions; ${analysis.conflicts.requiredSeparations.length} incoming separations`,
		});
		for (const face of analysis.faces) {
			for (const alternative of face.alternatives) {
				if (alternative.respectsRequiredSeparations) continue;
				trace.push({
					candidateId,
					kind: 'face-partition-rejected',
					detail: `${face.endpointId}/partition-${alternative.partitionIndex}: required separation`,
				});
			}
		}
		for (const branch of candidateBranches(analysis)) {
			if (exploredBranches >= budget) {
				branches.push(branch);
				continue;
			}
			const explored: JointK32Branch = { ...branch, status: 'symbolic-admissible' };
			branches.push(explored);
			exploredBranches++;
			trace.push({ candidateId, kind: 'branch', detail: explored.id });
			if (incumbent === undefined || better(explored, incumbent)) {
				incumbent = explored;
				trace.push({
					candidateId,
					kind: 'incumbent',
					detail: `${explored.id}: growth ${explored.totalGrowth}, maximum face ${explored.maximumCrossSize}, forced inversions ${explored.forcedOrderInversionCount}`,
				});
			}
		}
	}
	const incomplete = branches.some(({ status }) => status === 'not-explored');
	if (incomplete)
		trace.push({
			candidateId: '',
			kind: 'budget-exhausted',
			detail: `${exploredBranches}/${branches.length} symbolic branches explored`,
		});
	let searchStatus: JointK32Result['searchStatus'] = 'complete';
	if (incomplete) searchStatus = 'incomplete';
	return {
		analyses,
		branches,
		trace,
		incumbent,
		exploredBranches,
		budget,
		searchStatus,
		globalStatus: 'undetermined',
	};
}

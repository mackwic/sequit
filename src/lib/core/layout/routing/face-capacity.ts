import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';

enum FaceRole {
	Incoming = 'incoming',
	Outgoing = 'outgoing',
}

/** A small symbolic witness for three incidences on one face, without route geometry. */
interface FaceIncidence {
	readonly relationId: string;
	readonly oppositeEndpointId: string;
}

interface RequiredSeparation {
	readonly firstRelationId: string;
	readonly secondRelationId: string;
}

export interface FaceCapacityInput {
	readonly endpointId: string;
	readonly role: `${FaceRole}`;
	readonly incidences: readonly FaceIncidence[];
	readonly intrinsicCrossSize: number;
	readonly inset: number;
	readonly spacing: number;
	/** Routing incompatibilities supplied by a caller, never inferred from relation identities. */
	readonly requiredSeparations?: readonly RequiredSeparation[];
}

interface FaceCapacityAlternative {
	readonly portGroups: readonly (readonly string[])[];
	/** Other layout and routing constraints have not been evaluated. */
	readonly respectsRequiredSeparations: boolean;
	readonly metricDemand: {
		readonly minimumCrossSize: number;
		readonly growth: number;
	};
}

export interface FaceCapacityContract {
	readonly endpointId: string;
	readonly role: `${FaceRole}`;
	readonly incidences: readonly FaceIncidence[];
	readonly requiredSeparations: readonly RequiredSeparation[];
	readonly alternatives: readonly FaceCapacityAlternative[];
}

function sortedSeparation(firstRelationId: string, secondRelationId: string): RequiredSeparation {
	if (compareCanonicalStrings(firstRelationId, secondRelationId) < 0)
		return { firstRelationId, secondRelationId };
	return { firstRelationId: secondRelationId, secondRelationId: firstRelationId };
}

function validateAndSortSeparations(
	input: FaceCapacityInput,
	relationIds: ReadonlySet<string>,
): readonly RequiredSeparation[] {
	const keys = new Set<string>();
	const result: RequiredSeparation[] = [];
	for (const pair of input.requiredSeparations ?? []) {
		const repeated = pair.firstRelationId === pair.secondRelationId;
		const missingFirst = !relationIds.has(pair.firstRelationId);
		const missingSecond = !relationIds.has(pair.secondRelationId);
		if (repeated || missingFirst || missingSecond)
			throw new Error('A required separation must name two distinct face incidences.');
		const normalized = sortedSeparation(pair.firstRelationId, pair.secondRelationId);
		const key = JSON.stringify([normalized.firstRelationId, normalized.secondRelationId]);
		if (keys.has(key)) continue;
		keys.add(key);
		result.push(normalized);
	}
	return result.sort(
		(a, b) =>
			compareCanonicalStrings(a.firstRelationId, b.firstRelationId) ||
			compareCanonicalStrings(a.secondRelationId, b.secondRelationId),
	);
}

function respectsSeparations(
	groups: readonly (readonly string[])[],
	separations: readonly RequiredSeparation[],
): boolean {
	return separations.every(
		({ firstRelationId, secondRelationId }) =>
			!groups.some((group) => group.includes(firstRelationId) && group.includes(secondRelationId)),
	);
}

/** Enumerates the five port partitions for exactly three relations; no branch is selected. */
export function threeIncidenceFaceCapacity(input: FaceCapacityInput): FaceCapacityContract {
	if (input.incidences.length !== 3)
		throw new Error('The face-capacity witness requires exactly three incidences.');
	const invalidSize = !Number.isFinite(input.intrinsicCrossSize) || input.intrinsicCrossSize <= 0;
	const invalidInset = !Number.isFinite(input.inset) || input.inset < 0;
	const invalidSpacing = !Number.isFinite(input.spacing) || input.spacing <= 0;
	if (invalidSize || invalidInset || invalidSpacing)
		throw new Error(
			'Face measurements require a positive size and spacing, and a non-negative inset.',
		);
	const incidences = input.incidences
		.map((incidence) => ({ ...incidence }))
		.sort((a, b) => compareCanonicalStrings(a.relationId, b.relationId));
	const relationIds = new Set(incidences.map(({ relationId }) => relationId));
	if (relationIds.size !== 3) throw new Error('Face incidence relation IDs must be unique.');
	const requiredSeparations = validateAndSortSeparations(input, relationIds);
	const a = defined(incidences[0]).relationId;
	const b = defined(incidences[1]).relationId;
	const c = defined(incidences[2]).relationId;
	const partitions = [[[a, b, c]], [[a, b], [c]], [[a, c], [b]], [[a], [b, c]], [[a], [b], [c]]];
	const alternatives = partitions.map((portGroups) => {
		const faceInsets = 2 * input.inset;
		const portSpacing = (portGroups.length - 1) * input.spacing;
		const required = faceInsets + portSpacing;
		const minimumCrossSize = Math.max(input.intrinsicCrossSize, required);
		return {
			portGroups,
			respectsRequiredSeparations: respectsSeparations(portGroups, requiredSeparations),
			metricDemand: {
				minimumCrossSize,
				growth: minimumCrossSize - input.intrinsicCrossSize,
			},
		};
	});
	return {
		endpointId: input.endpointId,
		role: input.role,
		incidences,
		requiredSeparations,
		alternatives,
	};
}

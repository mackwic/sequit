import { compareCanonicalStrings } from '../../../canonical-string';
import type { RegionCompositionModel } from '../model/region-composition-model';
import type { RegionRelationOwnership } from '../model/region-composition-relations';

/** Fair diagonals expose each leaf's next local alternative by total alternative rank. */
export function* indexVectors(
	count: number,
	total: number,
	maxIndex: (dimension: number) => number,
): Generator<readonly number[]> {
	const indices: number[] = [];
	function* visit(level: number, remaining: number): Generator<readonly number[]> {
		if (level === count) {
			if (remaining === 0) yield [...indices];
			return;
		}
		for (let index = 0; index <= Math.min(remaining, maxIndex(level)); index += 1) {
			indices.push(index);
			yield* visit(level + 1, remaining - index);
			indices.pop();
		}
	}
	yield* visit(0, total);
}

interface IncidentRelationSpan {
	readonly owned: RegionRelationOwnership;
	readonly sourcePosition: number;
	readonly targetPosition: number;
	readonly start: number;
	readonly end: number;
	nesting: number;
}

function compareEndpointPositions(
	leftId: string,
	rightId: string,
	positions: ReadonlyMap<string, number>,
): number {
	const left = positions.get(leftId);
	const right = positions.get(rightId);
	if (left !== undefined && right !== undefined) return left - right;
	if (left !== undefined) return -1;
	if (right !== undefined) return 1;
	return compareCanonicalStrings(leftId, rightId);
}

function compareIncidentSpans(
	left: IncidentRelationSpan,
	right: IncidentRelationSpan,
	positions: ReadonlyMap<string, number>,
): number {
	const nesting = right.nesting - left.nesting;
	if (nesting !== 0) return nesting;
	const length = left.end - left.start - (right.end - right.start);
	if (length !== 0) return length;
	const source = compareEndpointPositions(
		left.owned.relation.from,
		right.owned.relation.from,
		positions,
	);
	if (source !== 0) return source;
	const target = compareEndpointPositions(
		left.owned.relation.to,
		right.owned.relation.to,
		positions,
	);
	if (target !== 0) return target;
	return compareCanonicalStrings(left.owned.relation.id, right.owned.relation.id);
}

function countIncidentSpanNesting(spans: IncidentRelationSpan[]): void {
	for (const span of spans) {
		for (const other of spans) {
			if (other === span) continue;
			const startsInside = other.start < span.start;
			const endsInside = span.end < other.end;
			if (startsInside && endsInside) span.nesting += 1;
		}
	}
}

/** Enumerate narrow, nested portal spans first; document positions break geometric ties. */
export function incidentLeafIds(
	model: RegionCompositionModel,
	positions: ReadonlyMap<string, number>,
): readonly string[] {
	const spans: IncidentRelationSpan[] = [];
	for (const owned of model.relations) {
		if (owned.sourceLeafId === owned.targetLeafId) continue;
		const sourcePosition = positions.get(owned.relation.from);
		const targetPosition = positions.get(owned.relation.to);
		if (sourcePosition === undefined || targetPosition === undefined) continue;
		spans.push({
			owned,
			sourcePosition,
			targetPosition,
			start: Math.min(sourcePosition, targetPosition),
			end: Math.max(sourcePosition, targetPosition),
			nesting: 0,
		});
	}
	countIncidentSpanNesting(spans);
	spans.sort((left, right) => compareIncidentSpans(left, right, positions));
	const leaves = new Set<string>();
	for (const span of spans) {
		if (span.sourcePosition < span.targetPosition) {
			leaves.add(span.owned.sourceLeafId);
			leaves.add(span.owned.targetLeafId);
		} else {
			leaves.add(span.owned.targetLeafId);
			leaves.add(span.owned.sourceLeafId);
		}
	}
	return [...leaves];
}

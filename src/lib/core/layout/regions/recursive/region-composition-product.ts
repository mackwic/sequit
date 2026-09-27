import { compareCanonicalStrings } from '../../../canonical-string';
import type { RegionCompositionModel } from '../model/region-composition-model';

/** Fair diagonals expose each leaf's second choice before exhausting another leaf. */
export function* indexVectors(count: number, total: number): Generator<readonly number[]> {
	const indices: number[] = [];
	function* visit(level: number, remaining: number): Generator<readonly number[]> {
		if (level === count) {
			if (remaining === 0) yield [...indices];
			return;
		}
		for (let index = 0; index <= remaining; index += 1) {
			indices.push(index);
			yield* visit(level + 1, remaining - index);
			indices.pop();
		}
	}
	yield* visit(0, total);
}

export function incidentLeafIds(model: RegionCompositionModel): readonly string[] {
	const ids = new Set<string>();
	for (const owned of model.relations) {
		if (owned.sourceLeafId === owned.targetLeafId) continue;
		ids.add(owned.sourceLeafId);
		ids.add(owned.targetLeafId);
	}
	return [...ids].sort(compareCanonicalStrings);
}

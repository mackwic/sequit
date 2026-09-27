import { compareCanonicalStrings } from '../../../canonical-string';
import type { RegionCompositionModel } from '../model/region-composition-model';

export function incidentLeafIds(model: RegionCompositionModel): readonly string[] {
	const ids = new Set<string>();
	for (const owned of model.relations) {
		if (owned.sourceLeafId === owned.targetLeafId) continue;
		ids.add(owned.sourceLeafId);
		ids.add(owned.targetLeafId);
	}
	return [...ids].sort(compareCanonicalStrings);
}

import { defined } from '../document/logic-document';
import type { RegionCompositionModel } from './region-composition-model';

export function regionQualifiedFailure(model: RegionCompositionModel, failure: string): string {
	const owner = model.relations.find(({ relation }) =>
		failure.startsWith(`Relation ${relation.id} `),
	)?.ownerId;
	if (owner === undefined || owner === model.rootId) return failure;
	return `Region ${owner}: ${failure}`;
}

export function retryOwnerForIncidentFailure(
	model: RegionCompositionModel,
	failure: string,
): string | undefined {
	const geometricFailure =
		failure.includes(' crosses foreign node ') ||
		failure.includes(' touches local relation ') ||
		failure.includes(' does not attach to node ');
	if (!geometricFailure) return undefined;
	const owned = model.relations.find(({ relation }) =>
		failure.startsWith(`Relation ${relation.id} `),
	);
	const ownerId = owned?.ownerId;
	if (ownerId === undefined) return undefined;
	const owner = model.regionsById.get(ownerId);
	if (owner?.childIds.length === 0) return undefined;
	if (ownerId === model.rootId) {
		const relation = defined(owned);
		const sourceLanes = model.regionsById.get(relation.sourceLeafId)?.definition.lanePresentation;
		const targetLanes = model.regionsById.get(relation.targetLeafId)?.definition.lanePresentation;
		if (sourceLanes === undefined && targetLanes === undefined) return undefined;
	}
	if (ownerId !== model.rootId && owner?.definition.layout === undefined) return undefined;
	return ownerId;
}

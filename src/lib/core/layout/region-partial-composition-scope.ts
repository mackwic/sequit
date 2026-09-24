import { defined, type LogicDocument } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { type RegionCompositionModel, RegionRelationKind } from './region-composition-model';
import type { RegionInput } from './region-composition-types';

export function incidentLeafIds(model: RegionCompositionModel): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const owned of model.relations) {
		if (owned.kind !== RegionRelationKind.Crossing) continue;
		ids.add(owned.sourceLeafId);
		ids.add(owned.targetLeafId);
	}
	return ids;
}

export function subtreeRegionIds(
	model: RegionCompositionModel,
	rootId: string,
): ReadonlySet<string> {
	const ids = new Set<string>([rootId]);
	for (const regionId of model.preorderIds) {
		const parentId = model.regionsById.get(regionId)?.parentId;
		if (parentId !== undefined && ids.has(parentId)) ids.add(regionId);
	}
	return ids;
}

export function subtreeEndpointIds(
	model: RegionCompositionModel,
	regionIds: ReadonlySet<string>,
): ReadonlySet<string> {
	const endpointIds = new Set<string>();
	for (const [endpointId, leafId] of model.leafByEndpointId)
		if (regionIds.has(leafId)) endpointIds.add(endpointId);
	return endpointIds;
}

export function closedSubtree(
	model: RegionCompositionModel,
	endpointIds: ReadonlySet<string>,
): boolean {
	return model.relations.every(({ relation }) => {
		const sourceInside = endpointIds.has(relation.from);
		const targetInside = endpointIds.has(relation.to);
		return sourceInside === targetInside;
	});
}

export function subtreeDocument(
	graph: LogicGraph,
	endpointIds: ReadonlySet<string>,
): LogicDocument {
	const source = graph.document;
	return {
		persistenceFormat: source.persistenceFormat,
		id: source.id,
		title: source.title,
		layout: source.layout,
		natures: source.natures,
		nodes: source.nodes.filter(({ id }) => endpointIds.has(id)),
		groups: source.groups.filter(({ id }) => endpointIds.has(id)),
		junctions: source.junctions.filter(({ id }) => endpointIds.has(id)),
		relations: source.relations.filter(
			({ from, to }) => endpointIds.has(from) && endpointIds.has(to),
		),
	};
}

export function subtreeInput(
	model: RegionCompositionModel,
	rootId: string,
	regionIds: ReadonlySet<string>,
	endpointIds: ReadonlySet<string>,
): RegionInput {
	const regions = model.preorderIds.flatMap((regionId) => {
		if (!regionIds.has(regionId)) return [];
		const definition = defined(model.regionsById.get(regionId)).definition;
		if (regionId !== rootId) return [definition];
		const root = { ...definition };
		Reflect.deleteProperty(root, 'parentId');
		return [root];
	});
	const regionByEndpointId = new Map(
		[...model.leafByEndpointId].filter(([endpointId]) => endpointIds.has(endpointId)),
	);
	return { regions, regionByEndpointId };
}

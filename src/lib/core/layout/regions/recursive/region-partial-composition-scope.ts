import { defined, type LogicDocument } from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import type { RegionCompositionWork } from '../model/region-composition-limits';
import {
	type RegionCompositionModel,
	RegionRelationKind,
	type RegionRelationOwnership,
} from '../model/region-composition-model';
import type { RegionInput, RegionInputDefinition } from '../model/region-composition-types';
import { RegionWorkPhase } from '../model/region-composition-types';

interface SubtreeRange {
	readonly start: number;
	readonly end: number;
}

interface OrderedValue<T> {
	readonly order: number;
	readonly value: T;
}

export interface RegionPartialCompositionIndex {
	readonly subtreeRangesByRegionId: ReadonlyMap<string, SubtreeRange>;
	readonly endpointIdsByLeafId: ReadonlyMap<string, readonly OrderedValue<string>[]>;
	readonly nodesByLeafId: ReadonlyMap<
		string,
		readonly OrderedValue<LogicDocument['nodes'][number]>[]
	>;
	readonly groupsByLeafId: ReadonlyMap<
		string,
		readonly OrderedValue<LogicDocument['groups'][number]>[]
	>;
	readonly junctionsByLeafId: ReadonlyMap<
		string,
		readonly OrderedValue<LogicDocument['junctions'][number]>[]
	>;
	readonly relationsByOwnerId: ReadonlyMap<
		string,
		readonly OrderedValue<LogicDocument['relations'][number]>[]
	>;
	readonly ownershipByRelationId: ReadonlyMap<string, RegionRelationOwnership>;
	readonly openSubtreeRegionIds: ReadonlySet<string>;
	readonly incidentLeafIds: ReadonlySet<string>;
}

function indexByOwner<T extends { readonly id: string }>(
	values: readonly T[],
	ownerById: ReadonlyMap<string, string>,
	work: RegionCompositionWork,
): ReadonlyMap<string, readonly OrderedValue<T>[]> {
	const result = new Map<string, OrderedValue<T>[]>();
	for (let order = 0; order < values.length; order += 1) {
		const value = defined(values[order]);
		work.charge(RegionWorkPhase.Traversals, value.id);
		const ownerId = ownerById.get(value.id);
		if (ownerId === undefined) continue;
		let bucket = result.get(ownerId);
		if (bucket === undefined) {
			bucket = [];
			result.set(ownerId, bucket);
		}
		bucket.push({ order, value });
	}
	return result;
}

function orderedSubtreeValues<T>(
	byOwnerId: ReadonlyMap<string, readonly OrderedValue<T>[]>,
	regionIds: readonly string[],
	work: RegionCompositionWork,
	ownerId: string,
): readonly T[] {
	const values: OrderedValue<T>[] = [];
	for (const regionId of regionIds) {
		for (const ordered of byOwnerId.get(regionId) ?? []) {
			work.charge(RegionWorkPhase.Traversals, regionId);
			values.push(ordered);
		}
	}
	values.sort((left, right) => {
		work.charge(RegionWorkPhase.Comparisons, ownerId);
		return left.order - right.order;
	});
	return values.map(({ value }) => value);
}

function indexSubtreeRanges(
	model: RegionCompositionModel,
	work: RegionCompositionWork,
): ReadonlyMap<string, SubtreeRange> {
	const subtreeRangesByRegionId = new Map<string, SubtreeRange>();
	const pending: { readonly regionId: string; readonly depth: number }[] = [];
	for (let index = 0; index < model.preorderIds.length; index += 1) {
		const regionId = defined(model.preorderIds[index]);
		const depth = defined(model.regionsById.get(regionId)).depth;
		work.charge(RegionWorkPhase.Traversals, regionId);
		while (pending.length > 0) {
			const previousPending = defined(pending.at(-1));
			if (previousPending.depth < depth) break;
			const previous = defined(pending.pop());
			const range = defined(subtreeRangesByRegionId.get(previous.regionId));
			subtreeRangesByRegionId.set(previous.regionId, { start: range.start, end: index });
			work.charge(RegionWorkPhase.Traversals, previous.regionId);
		}
		subtreeRangesByRegionId.set(regionId, { start: index, end: model.preorderIds.length });
		pending.push({ regionId, depth });
	}
	while (pending.length > 0) {
		const previous = defined(pending.pop());
		const range = defined(subtreeRangesByRegionId.get(previous.regionId));
		subtreeRangesByRegionId.set(previous.regionId, {
			start: range.start,
			end: model.preorderIds.length,
		});
		work.charge(RegionWorkPhase.Traversals, previous.regionId);
	}
	return subtreeRangesByRegionId;
}

export function indexRegionPartialComposition(
	graph: LogicGraph,
	model: RegionCompositionModel,
	work: RegionCompositionWork,
): RegionPartialCompositionIndex {
	const subtreeRangesByRegionId = indexSubtreeRanges(model, work);
	const endpointIdsByLeafId = new Map<string, OrderedValue<string>[]>();
	let endpointOrder = 0;
	for (const [endpointId, leafId] of model.leafByEndpointId) {
		work.charge(RegionWorkPhase.Traversals, leafId);
		let bucket = endpointIdsByLeafId.get(leafId);
		if (bucket === undefined) {
			bucket = [];
			endpointIdsByLeafId.set(leafId, bucket);
		}
		bucket.push({ order: endpointOrder, value: endpointId });
		endpointOrder += 1;
	}

	const ownerByRelationId = new Map<string, string>();
	const ownershipByRelationId = new Map<string, RegionRelationOwnership>();
	const openSubtreeRegionIds = new Set<string>();
	const incidentLeafIds = new Set<string>();
	for (const owned of model.relations) {
		work.charge(RegionWorkPhase.Traversals, owned.relation.id);
		ownerByRelationId.set(owned.relation.id, owned.ownerId);
		ownershipByRelationId.set(owned.relation.id, owned);
		if (owned.kind === RegionRelationKind.Crossing) {
			incidentLeafIds.add(owned.sourceLeafId);
			incidentLeafIds.add(owned.targetLeafId);
		}
		for (const regionId of owned.sourcePathToOwner) {
			work.charge(RegionWorkPhase.Traversals, regionId);
			openSubtreeRegionIds.add(regionId);
		}
		for (const regionId of owned.targetPathToOwner) {
			work.charge(RegionWorkPhase.Traversals, regionId);
			openSubtreeRegionIds.add(regionId);
		}
	}

	return {
		subtreeRangesByRegionId,
		endpointIdsByLeafId,
		nodesByLeafId: indexByOwner(graph.document.nodes, model.leafByEndpointId, work),
		groupsByLeafId: indexByOwner(graph.document.groups, model.leafByEndpointId, work),
		junctionsByLeafId: indexByOwner(graph.document.junctions, model.leafByEndpointId, work),
		relationsByOwnerId: indexByOwner(graph.document.relations, ownerByRelationId, work),
		ownershipByRelationId,
		openSubtreeRegionIds,
		incidentLeafIds,
	};
}

export function subtreeRegionIds(
	model: RegionCompositionModel,
	index: RegionPartialCompositionIndex,
	rootId: string,
	work: RegionCompositionWork,
): readonly string[] {
	const range = defined(index.subtreeRangesByRegionId.get(rootId));
	const ids: string[] = [];
	for (let position = range.start; position < range.end; position += 1) {
		const regionId = defined(model.preorderIds[position]);
		work.charge(RegionWorkPhase.Traversals, regionId);
		ids.push(regionId);
	}
	return ids;
}

export function subtreeEndpointIds(
	index: RegionPartialCompositionIndex,
	regionIds: readonly string[],
	work: RegionCompositionWork,
	ownerId: string,
): readonly string[] {
	return orderedSubtreeValues(index.endpointIdsByLeafId, regionIds, work, ownerId);
}

export function closedSubtree(index: RegionPartialCompositionIndex, rootId: string): boolean {
	return !index.openSubtreeRegionIds.has(rootId);
}

export function subtreeDocument(
	graph: LogicGraph,
	index: RegionPartialCompositionIndex,
	regionIds: readonly string[],
	work: RegionCompositionWork,
): LogicDocument {
	const rootId = defined(regionIds[0]);
	const source = graph.document;
	return {
		persistenceFormat: source.persistenceFormat,
		id: source.id,
		title: source.title,
		layout: source.layout,
		natures: source.natures,
		nodes: orderedSubtreeValues(index.nodesByLeafId, regionIds, work, rootId),
		groups: orderedSubtreeValues(index.groupsByLeafId, regionIds, work, rootId),
		junctions: orderedSubtreeValues(index.junctionsByLeafId, regionIds, work, rootId),
		relations: orderedSubtreeValues(index.relationsByOwnerId, regionIds, work, rootId),
	};
}

export function subtreeInput(
	model: RegionCompositionModel,
	regionIds: readonly string[],
	endpointIds: readonly string[],
	work: RegionCompositionWork,
): RegionInput {
	const rootId = defined(regionIds[0]);
	const regions: RegionInputDefinition[] = [];
	for (const regionId of regionIds) {
		work.charge(RegionWorkPhase.Traversals, regionId);
		const definition = defined(model.regionsById.get(regionId)).definition;
		if (regionId !== rootId) {
			regions.push(definition);
			continue;
		}
		const root = { ...definition };
		Reflect.deleteProperty(root, 'parentId');
		regions.push(root);
	}
	const regionByEndpointId = new Map<string, string>();
	for (const endpointId of endpointIds) {
		work.charge(RegionWorkPhase.Traversals, endpointId);
		regionByEndpointId.set(endpointId, defined(model.leafByEndpointId.get(endpointId)));
	}
	return { regions, regionByEndpointId };
}

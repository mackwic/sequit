import {
	defined,
	EndpointKind,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	type RootLayoutPresentation,
} from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { LayoutMeasurements } from './layout-types';
import type { NestedRegionLocalLayoutCache } from './nested-region-local-cache';
import { NestedPortalSide } from './nested-region-types';
import type {
	RegionCompositionModel,
	RegionCompositionNode,
	RegionRelationOwnership,
} from './region-composition-model';
import { RegionRelationKind } from './region-composition-model';

export type IncidentSides = ReadonlyMap<string, NestedPortalSide>;

function ungroupedNode(endpoint: {
	readonly kind: EndpointKind;
	readonly entity: { readonly groupId?: string };
}): boolean {
	if (endpoint.kind !== EndpointKind.Node) return false;
	return endpoint.entity.groupId === undefined;
}

type RelationEndpoint = LogicGraph['relations'][number]['source'];

function directGroupMember(graph: LogicGraph, endpoint: RelationEndpoint): boolean {
	if (endpoint.kind !== EndpointKind.Node || endpoint.entity.groupId === undefined) return false;
	const parent = graph.endpointsById.get(endpoint.entity.groupId);
	return parent?.kind === EndpointKind.Group && parent.entity.groupId === undefined;
}

function ordinaryDirectGridCell(
	model: RegionCompositionModel,
	gridId: string,
	leafId: string,
): boolean {
	const region = model.regionsById.get(leafId);
	if (region?.parentId !== gridId || region.childIds.length !== 0) return false;
	return region.definition.lanePresentation === undefined;
}

function directGridGroupCrossing(input: {
	readonly graph: LogicGraph;
	readonly model: RegionCompositionModel;
	readonly owned: RegionRelationOwnership;
	readonly source: RelationEndpoint;
	readonly target: RelationEndpoint;
}): boolean {
	const { graph, model, owned, source, target } = input;
	const owner = model.regionsById.get(owned.ownerId);
	if (owner?.definition.grid === undefined) return false;
	if (!ordinaryDirectGridCell(model, owned.ownerId, owned.sourceLeafId)) return false;
	if (!ordinaryDirectGridCell(model, owned.ownerId, owned.targetLeafId)) return false;
	const sourceGroup = source.kind === EndpointKind.Group && source.entity.groupId === undefined;
	const targetGroup = target.kind === EndpointKind.Group && target.entity.groupId === undefined;
	if (sourceGroup && ungroupedNode(target)) return true;
	if (targetGroup && ungroupedNode(source)) return true;
	if (graph.document.persistenceFormat !== REGION_COMPOSITION_PERSISTENCE_FORMAT) return false;
	if (directGroupMember(graph, source) && ungroupedNode(target)) return true;
	return directGroupMember(graph, target) && ungroupedNode(source);
}

function gridHasOuterIncident(model: RegionCompositionModel, gridId: string): boolean {
	return model.relations.some((owned) => {
		if (owned.ownerId === gridId) return false;
		if (owned.sourcePathToOwner.includes(gridId)) return true;
		return owned.targetPathToOwner.includes(gridId);
	});
}

export interface RecursiveContext {
	readonly graph: LogicGraph;
	readonly model: RegionCompositionModel;
	readonly measurements: LayoutMeasurements;
	readonly cache: NestedRegionLocalLayoutCache | undefined;
	readonly ownershipByRelationId: ReadonlyMap<string, RegionRelationOwnership>;
	readonly dispositionSideByRegionId?: ReadonlyMap<string, NestedPortalSide>;
	readonly ghostLeafIds?: ReadonlySet<string>;
}

function regionPolicyFailure(
	region: RegionCompositionNode,
	model: RegionCompositionModel,
): string | undefined {
	const count = region.childIds.length;
	if (region.definition.grid !== undefined && count !== 4)
		return `Region ${region.id} grid requires four direct child regions.`;
	if (count > 0 && count < 2)
		return 'This bounded composition requires two or three direct child regions.';
	if (count > 3 && region.definition.grid === undefined)
		return 'This bounded composition requires two or three direct child regions.';
	if (count === 0) {
		const occupied = [...model.leafByEndpointId.values()].includes(region.id);
		if (!occupied) return 'Each leaf region must own an endpoint.';
	}
	if ((model.crossingRelationsByOwner.get(region.id)?.length ?? 0) > 3)
		return `Region ${region.id} accepts at most three owned crossings.`;
	if (count > 0 && region.definition.lanePresentation !== undefined)
		return `Region ${region.id} has lanes but is not a leaf.`;
	return undefined;
}

function crossingPolicyFailure(
	graph: LogicGraph,
	model: RegionCompositionModel,
): string | undefined {
	const directGroupGrids = new Set<string>();
	for (const owned of model.relations) {
		if (owned.kind !== RegionRelationKind.Crossing) continue;
		const source = defined(graph.endpointsById.get(owned.relation.from));
		const target = defined(graph.endpointsById.get(owned.relation.to));
		if (ungroupedNode(source) && ungroupedNode(target)) continue;
		if (!directGridGroupCrossing({ graph, model, owned, source, target }))
			return 'Cross-region relations currently require ungrouped node endpoints.';
		directGroupGrids.add(owned.ownerId);
	}
	for (const gridId of directGroupGrids)
		if (gridHasOuterIncident(model, gridId))
			return `Grid region ${gridId} does not combine direct group crossings with outer incidents.`;
	return undefined;
}

export function policyFailure(
	graph: LogicGraph,
	model: RegionCompositionModel,
): string | undefined {
	if (graph.document.presentation !== undefined)
		return 'Lanes are outside the bounded nested-region envelope.';
	if (graph.endpointsById.size > 12 || graph.document.relations.length > 16)
		return 'This bounded composition accepts at most twelve endpoints and sixteen relations.';
	const crossing = crossingPolicyFailure(graph, model);
	if (crossing !== undefined) return crossing;
	const root = defined(model.regionsById.get(model.rootId));
	if (root.childIds.length === 0)
		return 'This bounded composition requires two or three direct child regions.';
	for (const region of model.regionsById.values()) {
		const failure = regionPolicyFailure(region, model);
		if (failure !== undefined) return failure;
	}
	return undefined;
}

export function sideForRegion(context: RecursiveContext, regionId: string): NestedPortalSide {
	const selected = context.dispositionSideByRegionId?.get(regionId);
	if (selected !== undefined) return selected;
	const region = defined(context.model.regionsById.get(regionId));
	const direction = region.definition.layout?.direction ?? context.graph.document.layout.direction;
	if (direction === LayoutDirection.BottomToTop) return NestedPortalSide.Bottom;
	return NestedPortalSide.Top;
}

export function directChild(
	context: RecursiveContext,
	regionId: string,
	endpointId: string,
): string {
	let childId = defined(context.model.leafByEndpointId.get(endpointId));
	for (;;) {
		const parentId = defined(context.model.regionsById.get(childId)).parentId;
		if (parentId === regionId) return childId;
		childId = defined(parentId);
	}
}

export function leafDocument(context: RecursiveContext, regionId: string): LogicDocument {
	const source = context.graph.document;
	const region = defined(context.model.regionsById.get(regionId));
	const localRelations = defined(context.model.localRelationsByOwner.get(regionId));
	const localRelationIds = new Set(localRelations.map(({ id }) => id));
	const lanePresentation = region.definition.lanePresentation;
	let document: LogicDocument = {
		persistenceFormat: source.persistenceFormat,
		id: source.id,
		title: source.title,
		layout: region.definition.layout ?? source.layout,
		natures: source.natures,
		nodes: source.nodes.filter(({ id }) => context.model.leafByEndpointId.get(id) === regionId),
		groups: source.groups.filter(({ id }) => context.model.leafByEndpointId.get(id) === regionId),
		junctions: source.junctions.filter(
			({ id }) => context.model.leafByEndpointId.get(id) === regionId,
		),
		relations: source.relations.filter(({ id }) => localRelationIds.has(id)),
	};
	if (lanePresentation !== undefined) {
		const presentation: RootLayoutPresentation = {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: region.definition.policy ?? LayoutPolicy.Layered,
			...lanePresentation,
		};
		document = { ...document, presentation };
	}
	return document;
}

export function childSides(input: {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly childId: string;
	readonly incidentSides: IncidentSides;
	readonly localSide: NestedPortalSide;
}): IncidentSides {
	const { context, regionId, childId, incidentSides, localSide } = input;
	const sides = new Map<string, NestedPortalSide>();
	for (const owned of context.model.relations) {
		const inherited = incidentSides.get(owned.relation.id);
		if (owned.ownerId !== regionId && inherited === undefined) continue;
		let side = localSide;
		if (inherited !== undefined) side = inherited;
		const sourceHere = owned.ownerId === regionId || owned.sourcePathToOwner.includes(regionId);
		if (sourceHere && directChild(context, regionId, owned.relation.from) === childId)
			sides.set(owned.relation.id, side);
		const targetHere = owned.ownerId === regionId || owned.targetPathToOwner.includes(regionId);
		if (targetHere && directChild(context, regionId, owned.relation.to) === childId)
			sides.set(owned.relation.id, side);
	}
	return sides;
}

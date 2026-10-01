import {
	defined,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutDirection,
	type LogicDocument,
	type RootLayoutPresentation,
} from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import type { LayoutMeasurements } from '../../layout-types';
import type { RegionCompositionWork } from '../model/region-composition-limits';
import type {
	RegionCompositionModel,
	RegionCompositionNode,
	RegionRelationOwnership,
} from '../model/region-composition-model';
import { RegionPortalSide, RegionWorkPhase } from '../model/region-composition-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	RegionIncidentRole,
} from '../model/region-incident-contract';
import type { RegionLocalLayoutCache } from '../model/region-local-cache';

export type IncidentSides = ReadonlyMap<string, readonly RegionPortalSide[]>;

/** Resolve source provenance before the local policy sees the incident contract. */
export function leafIncidentContracts(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
): readonly RegionIncidentContract[] {
	const contracts: RegionIncidentContract[] = [];
	for (const [relationId, sides] of incidentSides) {
		const owned = defined(context.ownershipByRelationId.get(relationId));
		const sourceHere = owned.sourceLeafId === regionId;
		const targetHere = owned.targetLeafId === regionId;
		if (sourceHere === targetHere)
			throw new Error(`Incident ${relationId} has no unique endpoint in leaf ${regionId}.`);
		let endpointId = owned.relation.to;
		let role = RegionIncidentRole.Target;
		if (sourceHere) {
			endpointId = owned.relation.from;
			role = RegionIncidentRole.Source;
		}
		contracts.push({
			relation: owned.relation,
			endpointId,
			role,
			allowedSides: sides,
		});
	}
	return normalizeRegionIncidentContracts(contracts, context.endpointPositions);
}

export interface RecursiveContext {
	readonly graph: LogicGraph;
	readonly model: RegionCompositionModel;
	readonly measurements: LayoutMeasurements;
	readonly cache: RegionLocalLayoutCache | undefined;
	readonly endpointPositions: ReadonlyMap<string, number>;
	readonly ownershipByRelationId: ReadonlyMap<string, RegionRelationOwnership>;
	readonly dispositionSideByRegionId?: ReadonlyMap<string, RegionPortalSide>;
	readonly leafDocuments?: RegionLeafDocumentIndex;
}

function regionPolicyFailure(
	region: RegionCompositionNode,
	model: RegionCompositionModel,
	occupiedLeaves: ReadonlySet<string>,
): string | undefined {
	const count = region.childIds.length;
	if (count === 0) {
		if (occupiedLeaves.has(region.id)) return undefined;
		const parent = model.regionsById.get(region.parentId ?? '');
		if (parent?.definition.grid === undefined) return 'Each leaf region must own an endpoint.';
	}
	if (region.definition.grid !== undefined) {
		if (region.childIds.some((id) => defined(model.regionsById.get(id)).childIds.length > 0))
			return 'Grid cells with child regions are outside the bounded grid policy.';
		if (!region.childIds.some((id) => occupiedLeaves.has(id)))
			return 'An entirely empty grid is not supported; at least one cell must own an endpoint.';
	}
	return undefined;
}

export function policyFailure(
	graph: LogicGraph,
	model: RegionCompositionModel,
	work?: RegionCompositionWork,
): string | undefined {
	if (graph.document.presentation !== undefined)
		return 'Lanes are outside the bounded nested-region envelope.';
	const root = defined(model.regionsById.get(model.rootId));
	if (root.childIds.length === 0) return 'A bounded composition requires a nonempty root region.';
	const occupiedLeaves = new Set<string>();
	for (const leafId of model.leafByEndpointId.values()) {
		work?.charge(RegionWorkPhase.Traversals, leafId);
		occupiedLeaves.add(leafId);
	}
	for (const region of model.regionsById.values()) {
		work?.charge(RegionWorkPhase.Traversals, region.id);
		const failure = regionPolicyFailure(region, model, occupiedLeaves);
		if (failure !== undefined) return failure;
	}
	return undefined;
}

export function sideForRegion(context: RecursiveContext, regionId: string): RegionPortalSide {
	const selected = context.dispositionSideByRegionId?.get(regionId);
	if (selected !== undefined) return selected;
	const region = defined(context.model.regionsById.get(regionId));
	const direction = region.definition.layout?.direction ?? context.graph.document.layout.direction;
	if (direction === LayoutDirection.BottomToTop) return RegionPortalSide.Bottom;
	return RegionPortalSide.Top;
}

export function directChild(
	context: RecursiveContext,
	regionId: string,
	endpointId: string,
): string {
	let childId = defined(context.model.leafByEndpointId.get(endpointId));
	for (let depth = 0; depth < context.model.regionsById.size; depth += 1) {
		const parentId = defined(context.model.regionsById.get(childId)).parentId;
		if (parentId === regionId) return childId;
		childId = defined(parentId);
	}
	throw new Error(`Endpoint ${endpointId} is not below region ${regionId}.`);
}

/** Borrowed source entities are indexed once, preserving each collection's document order. */
export interface RegionLeafDocumentIndex {
	readonly nodes: ReadonlyMap<string, readonly LogicDocument['nodes'][number][]>;
	readonly groups: ReadonlyMap<string, readonly LogicDocument['groups'][number][]>;
	readonly junctions: ReadonlyMap<string, readonly LogicDocument['junctions'][number][]>;
	readonly relations: ReadonlyMap<string, readonly LogicDocument['relations'][number][]>;
}

function entitiesByLeaf<T extends { readonly id: string }>(
	entities: readonly T[],
	leafByEndpointId: ReadonlyMap<string, string>,
	work?: RegionCompositionWork,
): ReadonlyMap<string, readonly T[]> {
	const byLeaf = new Map<string, T[]>();
	for (const entity of entities) {
		work?.charge(RegionWorkPhase.Traversals, entity.id);
		const leaf = leafByEndpointId.get(entity.id);
		if (leaf === undefined) continue;
		let collected = byLeaf.get(leaf);
		if (collected === undefined) {
			collected = [];
			byLeaf.set(leaf, collected);
		}
		collected.push(entity);
	}
	return byLeaf;
}

export function indexRegionLeafDocuments(
	graph: LogicGraph,
	model: RegionCompositionModel,
	work?: RegionCompositionWork,
): RegionLeafDocumentIndex {
	const source = graph.document;
	const ownerByLocalRelationId = new Map<string, string>();
	for (const [leaf, relations] of model.localRelationsByOwner)
		for (const relation of relations) {
			work?.charge(RegionWorkPhase.Traversals, relation.id);
			ownerByLocalRelationId.set(relation.id, leaf);
		}
	return {
		nodes: entitiesByLeaf(source.nodes, model.leafByEndpointId, work),
		groups: entitiesByLeaf(source.groups, model.leafByEndpointId, work),
		junctions: entitiesByLeaf(source.junctions, model.leafByEndpointId, work),
		relations: entitiesByLeaf(source.relations, ownerByLocalRelationId, work),
	};
}

export function leafDocument(context: RecursiveContext, regionId: string): LogicDocument {
	const source = context.graph.document;
	const region = defined(context.model.regionsById.get(regionId));
	const indexed = context.leafDocuments ?? indexRegionLeafDocuments(context.graph, context.model);
	const lanePresentation = region.definition.lanePresentation;
	let document: LogicDocument = {
		persistenceFormat: source.persistenceFormat,
		id: source.id,
		title: source.title,
		layout: region.definition.layout ?? source.layout,
		natures: source.natures,
		nodes: indexed.nodes.get(regionId) ?? [],
		groups: indexed.groups.get(regionId) ?? [],
		junctions: indexed.junctions.get(regionId) ?? [],
		relations: indexed.relations.get(regionId) ?? [],
	};
	if (lanePresentation !== undefined) {
		const presentation: RootLayoutPresentation = {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: region.definition.policy,
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
	readonly localSide: RegionPortalSide;
}): IncidentSides {
	const { context, regionId, childId, incidentSides, localSide } = input;
	const sides = new Map<string, readonly RegionPortalSide[]>();
	for (const owned of context.model.relations) {
		const inherited = incidentSides.get(owned.relation.id);
		if (owned.ownerId !== regionId && inherited === undefined) continue;
		let allowedSides: readonly RegionPortalSide[] = [localSide];
		if (inherited !== undefined) allowedSides = inherited;
		const sourceHere = owned.ownerId === regionId || owned.sourcePathToOwner.includes(regionId);
		if (sourceHere && directChild(context, regionId, owned.relation.from) === childId)
			sides.set(owned.relation.id, allowedSides);
		const targetHere = owned.ownerId === regionId || owned.targetPathToOwner.includes(regionId);
		if (targetHere && directChild(context, regionId, owned.relation.to) === childId)
			sides.set(owned.relation.id, allowedSides);
	}
	return sides;
}

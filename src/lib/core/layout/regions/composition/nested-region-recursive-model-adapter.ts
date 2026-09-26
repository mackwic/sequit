import {
	defined,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutDirection,
	type LogicDocument,
	type RootLayoutPresentation,
} from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import type { LayoutMeasurements } from '../../layout-types';
import type {
	RegionCompositionModel,
	RegionCompositionNode,
	RegionRelationOwnership,
} from '../model/region-composition-model';
import { RegionPortalSide } from '../model/region-composition-types';
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
	return normalizeRegionIncidentContracts(contracts);
}

export interface RecursiveContext {
	readonly graph: LogicGraph;
	readonly model: RegionCompositionModel;
	readonly measurements: LayoutMeasurements;
	readonly cache: RegionLocalLayoutCache | undefined;
	readonly ownershipByRelationId: ReadonlyMap<string, RegionRelationOwnership>;
	readonly dispositionSideByRegionId?: ReadonlyMap<string, RegionPortalSide>;
}

function regionPolicyFailure(
	region: RegionCompositionNode,
	model: RegionCompositionModel,
): string | undefined {
	const count = region.childIds.length;
	if (count === 0) {
		const occupied = [...model.leafByEndpointId.values()].includes(region.id);
		if (!occupied) return 'Each leaf region must own an endpoint.';
	}
	return undefined;
}

export function policyFailure(
	graph: LogicGraph,
	model: RegionCompositionModel,
): string | undefined {
	if (graph.document.presentation !== undefined)
		return 'Lanes are outside the bounded nested-region envelope.';
	const root = defined(model.regionsById.get(model.rootId));
	if (root.childIds.length === 0) return 'A bounded composition requires a nonempty root region.';
	for (const region of model.regionsById.values()) {
		const failure = regionPolicyFailure(region, model);
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

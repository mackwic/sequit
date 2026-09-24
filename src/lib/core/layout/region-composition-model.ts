import { compareCanonicalStrings } from '../canonical-string';
import type { LogicRelation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import {
	partitionRelations,
	type RegionRelationOwnership,
	relationOwnership,
} from './region-composition-relations';
import {
	normalizedRegions,
	parentCycle,
	type RegionCompositionNode,
} from './region-composition-tree';
import type { RegionDefinition, RegionInput } from './region-composition-types';

export type { RegionRelationOwnership } from './region-composition-relations';
export { RegionRelationKind } from './region-composition-relations';
export type { RegionCompositionNode } from './region-composition-tree';

export enum RegionCompositionModelStatus {
	Ready = 'ready',
	Invalid = 'invalid',
	Unsupported = 'unsupported',
}

export enum RegionCompositionDiagnosticCode {
	EmptyRegionId = 'empty-region-id',
	DuplicateRegionId = 'duplicate-region-id',
	InvalidRootCount = 'invalid-root-count',
	UnknownParent = 'unknown-parent',
	ParentCycle = 'parent-cycle',
	MissingEndpointAssignment = 'missing-endpoint-assignment',
	UnknownEndpointAssignment = 'unknown-endpoint-assignment',
	UnknownRegionAssignment = 'unknown-region-assignment',
	NonLeafAssignment = 'non-leaf-assignment',
	SplitGroup = 'split-group',
	DuplicateRelationId = 'duplicate-relation-id',
	ResourceLimit = 'resource-limit',
}

interface RegionCompositionDiagnostic {
	readonly code: RegionCompositionDiagnosticCode;
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
	readonly limit?: number;
	readonly actual?: number;
}

export interface RegionCompositionLimits {
	readonly maxRegions?: number;
	readonly maxEndpoints?: number;
	readonly maxRelations?: number;
}

export interface RegionCompositionModel {
	readonly rootId: string;
	readonly preorderIds: readonly string[];
	readonly regionsById: ReadonlyMap<string, RegionCompositionNode>;
	readonly leafByEndpointId: ReadonlyMap<string, string>;
	readonly parentGroupByEndpointId: ReadonlyMap<string, string>;
	readonly relations: readonly RegionRelationOwnership[];
	readonly localRelationsByOwner: ReadonlyMap<string, readonly LogicRelation[]>;
	readonly crossingRelationsByOwner: ReadonlyMap<string, readonly LogicRelation[]>;
}

interface ReadyRegionCompositionModel {
	readonly status: RegionCompositionModelStatus.Ready;
	readonly model: RegionCompositionModel;
}

interface FailedRegionCompositionModel {
	readonly status: RegionCompositionModelStatus.Invalid | RegionCompositionModelStatus.Unsupported;
	readonly diagnostic: RegionCompositionDiagnostic;
}

export type RegionCompositionModelBuild =
	ReadyRegionCompositionModel | FailedRegionCompositionModel;

function invalid(
	code: RegionCompositionDiagnosticCode,
	message: string,
	path: readonly string[],
	cycle?: readonly string[],
): RegionCompositionModelBuild {
	const diagnostic: RegionCompositionDiagnostic = { code, message, path };
	if (cycle !== undefined)
		return {
			status: RegionCompositionModelStatus.Invalid,
			diagnostic: { ...diagnostic, cycle },
		};
	return {
		status: RegionCompositionModelStatus.Invalid,
		diagnostic,
	};
}

enum RegionResource {
	Regions = 'regions',
	Endpoints = 'endpoints',
	Relations = 'relations',
}

function resourceFailure(
	name: RegionResource,
	actual: number,
	limit: number | undefined,
): RegionCompositionModelBuild | undefined {
	if (limit === undefined || actual <= limit) return undefined;
	return {
		status: RegionCompositionModelStatus.Unsupported,
		diagnostic: {
			code: RegionCompositionDiagnosticCode.ResourceLimit,
			message: `${name} exceed the configured limit of ${limit}.`,
			path: [name],
			limit,
			actual,
		},
	};
}

function checkLimits(
	graph: LogicGraph,
	input: RegionInput,
	limits: RegionCompositionLimits,
): RegionCompositionModelBuild | undefined {
	for (const limit of [limits.maxRegions, limits.maxEndpoints, limits.maxRelations]) {
		if (limit === undefined) continue;
		if (!Number.isSafeInteger(limit) || limit < 0)
			throw new Error('Region composition limits must be non-negative safe integers.');
	}
	return (
		resourceFailure(RegionResource.Regions, input.regions.length, limits.maxRegions) ??
		resourceFailure(RegionResource.Endpoints, graph.endpointsById.size, limits.maxEndpoints) ??
		resourceFailure(RegionResource.Relations, graph.relations.length, limits.maxRelations)
	);
}

function assignmentFailure(
	graph: LogicGraph,
	input: RegionInput,
	regionsById: ReadonlyMap<string, RegionCompositionNode>,
): RegionCompositionModelBuild | undefined {
	const endpointIds = [...graph.endpointsById.keys()].sort(compareCanonicalStrings);
	for (const endpointId of endpointIds) {
		const regionId = input.regionByEndpointId.get(endpointId);
		if (regionId === undefined)
			return invalid(
				RegionCompositionDiagnosticCode.MissingEndpointAssignment,
				`Endpoint ${endpointId} has no region assignment.`,
				['endpoints', endpointId, 'regionId'],
			);
		const region = regionsById.get(regionId);
		if (region === undefined)
			return invalid(
				RegionCompositionDiagnosticCode.UnknownRegionAssignment,
				`Endpoint ${endpointId} refers to unknown region ${regionId}.`,
				['endpoints', endpointId, 'regionId'],
			);
		if (region.childIds.length > 0)
			return invalid(
				RegionCompositionDiagnosticCode.NonLeafAssignment,
				`Endpoint ${endpointId} is assigned to non-leaf region ${regionId}.`,
				['endpoints', endpointId, 'regionId'],
			);
	}
	for (const endpointId of [...input.regionByEndpointId.keys()].sort(compareCanonicalStrings))
		if (!graph.endpointsById.has(endpointId))
			return invalid(
				RegionCompositionDiagnosticCode.UnknownEndpointAssignment,
				`Unknown endpoint ${endpointId} has a region assignment.`,
				['endpoints', endpointId],
			);
	const groupedEndpoints = [
		...graph.document.groups,
		...graph.document.nodes,
		...graph.document.junctions,
	].sort((left, right) => compareCanonicalStrings(left.id, right.id));
	for (const endpoint of groupedEndpoints) {
		if (endpoint.groupId === undefined) continue;
		if (
			input.regionByEndpointId.get(endpoint.id) === input.regionByEndpointId.get(endpoint.groupId)
		)
			continue;
		return invalid(
			RegionCompositionDiagnosticCode.SplitGroup,
			`Endpoint ${endpoint.id} and its group ${endpoint.groupId} belong to different regions.`,
			['endpoints', endpoint.id, 'regionId'],
		);
	}
	return undefined;
}

interface ParsedDefinitions {
	readonly definitions: ReadonlyMap<string, RegionDefinition>;
	readonly rootId: string;
}

function parseDefinitions(input: RegionInput): ParsedDefinitions | RegionCompositionModelBuild {
	const definitions = new Map<string, RegionDefinition>();
	for (const region of [...input.regions].sort((left, right) =>
		compareCanonicalStrings(left.id, right.id),
	)) {
		if (region.id.length === 0)
			return invalid(
				RegionCompositionDiagnosticCode.EmptyRegionId,
				'Region identities must be nonempty.',
				['regions'],
			);
		if (definitions.has(region.id))
			return invalid(
				RegionCompositionDiagnosticCode.DuplicateRegionId,
				`Duplicate region identity ${region.id}.`,
				['regions', region.id],
			);
		definitions.set(region.id, region);
	}
	for (const region of definitions.values())
		if (region.parentId !== undefined && !definitions.has(region.parentId))
			return invalid(
				RegionCompositionDiagnosticCode.UnknownParent,
				`Region ${region.id} refers to unknown parent ${region.parentId}.`,
				['regions', region.id, 'parentId'],
			);
	const cycle = parentCycle(definitions);
	if (cycle !== undefined)
		return invalid(
			RegionCompositionDiagnosticCode.ParentCycle,
			`Region parent cycle: ${cycle.join(' -> ')}.`,
			['regions', cycle[0] ?? ''],
			cycle,
		);
	const roots = [...definitions.values()].filter(({ parentId }) => parentId === undefined);
	if (roots.length !== 1)
		return invalid(
			RegionCompositionDiagnosticCode.InvalidRootCount,
			`Exactly one root region is required; found ${roots.length}.`,
			['regions'],
		);
	const root = roots[0];
	if (root === undefined) throw new Error('Validated root is missing.');
	return { definitions, rootId: root.id };
}

function duplicateRelationFailure(graph: LogicGraph): RegionCompositionModelBuild | undefined {
	const relationIds = [...graph.relations]
		.map(({ relation }) => relation.id)
		.sort(compareCanonicalStrings);
	for (let index = 1; index < relationIds.length; index += 1) {
		const relationId = relationIds[index];
		if (relationId !== relationIds[index - 1]) continue;
		return invalid(
			RegionCompositionDiagnosticCode.DuplicateRelationId,
			`Duplicate relation identity ${relationId}.`,
			['relations', relationId ?? ''],
		);
	}
	return undefined;
}

/** Normalize any finite region tree; solver-specific node and route budgets belong to policies. */
export function normalizeRegionCompositionModel(
	graph: LogicGraph,
	input: RegionInput,
	limits: RegionCompositionLimits = {},
): RegionCompositionModelBuild {
	const resource = checkLimits(graph, input, limits);
	if (resource !== undefined) return resource;
	const parsed = parseDefinitions(input);
	if ('status' in parsed) return parsed;
	const { rootId, definitions } = parsed;
	const { preorderIds, byId: regionsById } = normalizedRegions(rootId, definitions);
	const assignments = assignmentFailure(graph, input, regionsById);
	if (assignments !== undefined) return assignments;
	const duplicate = duplicateRelationFailure(graph);
	if (duplicate !== undefined) return duplicate;
	const leafByEndpointId = new Map(
		[...input.regionByEndpointId].sort(([left], [right]) => compareCanonicalStrings(left, right)),
	);
	const parentGroupByEndpointId = new Map<string, string>();
	for (const endpointId of [...graph.endpointsById.keys()].sort(compareCanonicalStrings)) {
		const groupId = graph.endpointsById.get(endpointId)?.entity.groupId;
		if (groupId !== undefined) parentGroupByEndpointId.set(endpointId, groupId);
	}
	const relations = relationOwnership(graph, leafByEndpointId, regionsById);
	const partitions = partitionRelations(preorderIds, relations);
	return {
		status: RegionCompositionModelStatus.Ready,
		model: {
			rootId,
			preorderIds,
			regionsById,
			leafByEndpointId,
			parentGroupByEndpointId,
			relations,
			localRelationsByOwner: partitions.local,
			crossingRelationsByOwner: partitions.crossing,
		},
	};
}

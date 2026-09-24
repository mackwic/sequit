import { compareCanonicalStrings } from '../canonical-string';
import type { LogicRelation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { RegionInput } from './region-composition-types';

/** Normalization outcome, shared by every composition entry point. */
export enum RegionCompositionModelStatus {
	Ready = 'ready',
	Invalid = 'invalid',
	Unsupported = 'unsupported',
}

/** Declared diagnostic identities of region normalization and its resource limits. */
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
	NonLeafLanePresentation = 'non-leaf-lane-presentation',
	ResourceLimit = 'resource-limit',
}

export interface RegionCompositionDiagnostic {
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
	readonly maxChildrenPerRegion?: number;
	readonly maxCrossingsPerRegion?: number;
}

/**
 * Declared resource envelope of the bounded recursive composition. Every bound is a
 * resource, never a structure: a single-child pass-through frame and a wider row are the
 * same row. Eight children keeps the row bus linear in its children (`PARENT_BUS_SPACING`
 * per allocated track) while admitting rows wider than the historical three.
 */
export const NESTED_REGION_COMPOSITION_LIMITS: RegionCompositionLimits = {
	maxEndpoints: 12,
	maxRelations: 16,
	maxChildrenPerRegion: 8,
	maxCrossingsPerRegion: 3,
};

enum RegionResource {
	Regions = 'regions',
	Endpoints = 'endpoints',
	Relations = 'relations',
	Children = 'children',
	Crossings = 'crossings',
}

function resourceFailure(
	name: RegionResource,
	actual: number,
	limit: number | undefined,
	path: readonly string[] = [name],
): RegionCompositionDiagnostic | undefined {
	if (limit === undefined || actual <= limit) return undefined;
	return {
		code: RegionCompositionDiagnosticCode.ResourceLimit,
		message: `${name} exceed the configured limit of ${limit}.`,
		path,
		limit,
		actual,
	};
}

/** Children owned by each parent region, keyed by the parent identity. */
export function regionChildCounts(input: RegionInput): ReadonlyMap<string, number> {
	const counts = new Map<string, number>();
	for (const region of input.regions) {
		if (region.parentId === undefined) continue;
		counts.set(region.parentId, (counts.get(region.parentId) ?? 0) + 1);
	}
	return counts;
}

function validateLimits(limits: RegionCompositionLimits): void {
	for (const limit of [
		limits.maxRegions,
		limits.maxEndpoints,
		limits.maxRelations,
		limits.maxChildrenPerRegion,
		limits.maxCrossingsPerRegion,
	]) {
		if (limit === undefined) continue;
		if (!Number.isSafeInteger(limit) || limit < 0)
			throw new Error('Region composition limits must be non-negative safe integers.');
	}
}

export function checkRegionLimits(
	graph: LogicGraph,
	input: RegionInput,
	limits: RegionCompositionLimits,
): RegionCompositionDiagnostic | undefined {
	validateLimits(limits);
	const base =
		resourceFailure(RegionResource.Regions, input.regions.length, limits.maxRegions) ??
		resourceFailure(RegionResource.Endpoints, graph.endpointsById.size, limits.maxEndpoints) ??
		resourceFailure(RegionResource.Relations, graph.relations.length, limits.maxRelations);
	if (base !== undefined) return base;
	if (limits.maxChildrenPerRegion === undefined) return undefined;
	const childCounts = regionChildCounts(input);
	for (const regionId of [...childCounts.keys()].sort(compareCanonicalStrings)) {
		const failure = resourceFailure(
			RegionResource.Children,
			childCounts.get(regionId) ?? 0,
			limits.maxChildrenPerRegion,
			['regions', regionId, 'children'],
		);
		if (failure !== undefined) return failure;
	}
	return undefined;
}

export function checkRegionCrossingLimits(
	regionIds: readonly string[],
	crossing: ReadonlyMap<string, readonly LogicRelation[]>,
	limit: number | undefined,
): RegionCompositionDiagnostic | undefined {
	if (limit === undefined) return undefined;
	for (const regionId of regionIds) {
		const failure = resourceFailure(
			RegionResource.Crossings,
			crossing.get(regionId)?.length ?? 0,
			limit,
			['regions', regionId, 'crossings'],
		);
		if (failure !== undefined) return failure;
	}
	return undefined;
}

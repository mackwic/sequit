import { compareCanonicalStrings } from '../../../canonical-string';
import { LayoutPolicy, type LogicRelation } from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import {
	regionChildCounts,
	type RegionCompositionDiagnostic,
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
	type RegionCompositionWork,
	RegionWorkLimitExceeded,
} from './region-composition-limits';
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
import type {
	RegionDefinition,
	RegionInput,
	RegionInputDefinition,
} from './region-composition-types';
import { RegionWorkPhase } from './region-composition-types';

export {
	RegionCompositionDiagnosticCode,
	RegionCompositionModelStatus,
} from './region-composition-limits';
export type { RegionRelationOwnership } from './region-composition-relations';
export { RegionRelationKind } from './region-composition-relations';
export type { RegionCompositionNode } from './region-composition-tree';

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

function unsupported(diagnostic: RegionCompositionDiagnostic): RegionCompositionModelBuild {
	return {
		status: RegionCompositionModelStatus.Unsupported,
		diagnostic,
	};
}

function compareRegionWork(left: string, right: string, work?: RegionCompositionWork): number {
	work?.charge(RegionWorkPhase.NormalizationComparisons, left);
	return compareCanonicalStrings(left, right);
}

function assignmentFailure(
	graph: LogicGraph,
	input: RegionInput,
	regionsById: ReadonlyMap<string, RegionCompositionNode>,
	work?: RegionCompositionWork,
): RegionCompositionModelBuild | undefined {
	const endpointIds = [...graph.endpointsById.keys()].sort((left, right) =>
		compareRegionWork(left, right, work),
	);
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
	for (const endpointId of [...input.regionByEndpointId.keys()].sort((left, right) =>
		compareRegionWork(left, right, work),
	))
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
	].sort((left, right) => compareRegionWork(left.id, right.id, work));
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

function inputPolicy(region: RegionInputDefinition, hasChildren: boolean): LayoutPolicy {
	if (region.policy !== undefined) return region.policy;
	if (!hasChildren && region.lanePresentation !== undefined) return LayoutPolicy.SharedLanes;
	return LayoutPolicy.Layered;
}

function nonLeafLaneFailure(
	region: RegionInputDefinition,
	children: number,
): RegionCompositionModelBuild | undefined {
	if (children === 0 || region.lanePresentation === undefined) return undefined;
	return invalid(
		RegionCompositionDiagnosticCode.NonLeafLanePresentation,
		`Region ${region.id} owns child regions but declares a leaf lane presentation.`,
		['regions', region.id],
	);
}

function parseDefinitions(
	input: RegionInput,
	work?: RegionCompositionWork,
): ParsedDefinitions | RegionCompositionModelBuild {
	const definitions = new Map<string, RegionDefinition>();
	const childCounts = regionChildCounts(input, work);
	for (const region of [...input.regions].sort((left, right) => {
		work?.charge(RegionWorkPhase.NormalizationComparisons, left.id);
		return compareCanonicalStrings(left.id, right.id);
	})) {
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
		const children = childCounts.get(region.id) ?? 0;
		const laneFailure = nonLeafLaneFailure(region, children);
		if (laneFailure !== undefined) return laneFailure;
		definitions.set(region.id, { ...region, policy: inputPolicy(region, children > 0) });
	}
	for (const region of definitions.values())
		if (region.parentId !== undefined && !definitions.has(region.parentId))
			return invalid(
				RegionCompositionDiagnosticCode.UnknownParent,
				`Region ${region.id} refers to unknown parent ${region.parentId}.`,
				['regions', region.id, 'parentId'],
			);
	const cycle = parentCycle(definitions, work);
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

function duplicateRelationFailure(
	graph: LogicGraph,
	work?: RegionCompositionWork,
): RegionCompositionModelBuild | undefined {
	const relationIds = [...graph.relations]
		.map(({ relation }) => relation.id)
		.sort((left, right) => compareRegionWork(left, right, work));
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
	work?: RegionCompositionWork,
): RegionCompositionModelBuild {
	try {
		const parsed = parseDefinitions(input, work);
		if ('status' in parsed) return parsed;
		const { preorderIds, byId: regionsById } = normalizedRegions(
			parsed.rootId,
			parsed.definitions,
			work,
		);
		const assignments = assignmentFailure(graph, input, regionsById, work);
		if (assignments !== undefined) return assignments;
		const duplicate = duplicateRelationFailure(graph, work);
		if (duplicate !== undefined) return duplicate;
		const leafByEndpointId = new Map(
			[...input.regionByEndpointId].sort(([left], [right]) => compareRegionWork(left, right, work)),
		);
		const parentGroupByEndpointId = new Map<string, string>();
		for (const endpointId of [...graph.endpointsById.keys()].sort((left, right) =>
			compareRegionWork(left, right, work),
		)) {
			const groupId = graph.endpointsById.get(endpointId)?.entity.groupId;
			if (groupId !== undefined) parentGroupByEndpointId.set(endpointId, groupId);
		}
		const relations = relationOwnership(graph, leafByEndpointId, regionsById, work);
		const partitions = partitionRelations(preorderIds, relations);
		return {
			status: RegionCompositionModelStatus.Ready,
			model: {
				rootId: parsed.rootId,
				preorderIds,
				regionsById,
				leafByEndpointId,
				parentGroupByEndpointId,
				relations,
				localRelationsByOwner: partitions.local,
				crossingRelationsByOwner: partitions.crossing,
			},
		};
	} catch (error) {
		if (error instanceof RegionWorkLimitExceeded) return unsupported(error.diagnostic);
		throw error;
	}
}

import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicDocument } from '../document/logic-document';
import { createGraph, type LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import { solveNestedRegionLayoutForProjection } from './nested-region-layout';
import { nestedRegionLocalMeasurements } from './nested-region-local-measurements';
import {
	closedSubtree,
	incidentLeafIds,
	subtreeDocument,
	subtreeEndpointIds,
	subtreeInput,
	subtreeRegionIds,
} from './region-partial-composition-scope';
import {
	solveRegionLeafLayout,
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './regions/leaf/region-leaf-layout';
import { regionLeafPolicy } from './regions/leaf/region-leaf-policy';
import {
	leafDocument,
	type RecursiveContext,
} from './regions/model/nested-region-recursive-model-adapter';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from './regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutAttempt,
} from './regions/model/region-composition-types';
import type { RegionLocalLayoutCache } from './regions/model/region-local-cache';
import type { RegionCompositionFailureEvidence } from './regions/model/region-search-evidence';

export enum RegionSubtreeScope {
	Leaf = 'leaf',
	ClosedSubtree = 'closed-subtree',
}

export const REGION_SUBTREE_CALCULATION_FAILED = 'calculation-failed' as const;

interface RegionSubtreeSelectedBase {
	readonly status: RegionCompositionStatus.Selected;
	readonly regionId: string;
	readonly document: LogicDocument;
	readonly layout: LayoutResult;
}

interface RegionLeafSubtreeSelected extends RegionSubtreeSelectedBase {
	readonly scope: RegionSubtreeScope.Leaf;
	readonly ranks: TopologicalRanks;
}

interface RegionClosedSubtreeSelected extends RegionSubtreeSelectedBase {
	readonly scope: RegionSubtreeScope.ClosedSubtree;
}

interface RegionSubtreeFailureBase {
	readonly regionId: string;
	readonly scope: RegionSubtreeScope;
	readonly reason: string;
	readonly failureRegionId?: string | undefined;
	readonly relationId?: string | undefined;
	readonly endpointIds: readonly string[];
	readonly relationIds: readonly string[];
}

export type RegionSubtreeFailure =
	| (RegionSubtreeFailureBase & {
			readonly status: RegionCompositionStatus.Unknown;
	  } & RegionCompositionFailureEvidence)
	| (RegionSubtreeFailureBase & {
			readonly status:
				RegionCompositionStatus.Unsupported | typeof REGION_SUBTREE_CALCULATION_FAILED;
			readonly provenance?: undefined;
			readonly code?: undefined;
			readonly witness?: undefined;
	  });

export type RegionSubtreeAttempt =
	RegionLeafSubtreeSelected | RegionClosedSubtreeSelected | RegionSubtreeFailure;

export interface RegionSubtreeAttemptInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly input: RegionInput;
	readonly cache: RegionLocalLayoutCache;
}

type FailureProvenance = RegionCompositionFailureEvidence & {
	readonly failureRegionId?: string | undefined;
	readonly relationId?: string | undefined;
};

interface FailureInputBase {
	readonly regionId: string;
	readonly scope: RegionSubtreeScope;
	readonly document: LogicDocument;
	readonly reason: string;
}

interface UnknownFailureInput extends FailureInputBase {
	readonly status: RegionCompositionStatus.Unknown;
	readonly provenance: FailureProvenance;
}

interface UnsupportedFailureInput extends FailureInputBase {
	readonly status: RegionCompositionStatus.Unsupported | typeof REGION_SUBTREE_CALCULATION_FAILED;
}

type FailureInput = UnknownFailureInput | UnsupportedFailureInput;

function failure(input: FailureInput): RegionSubtreeFailure {
	const relationIds = input.document.relations.map(({ id }) => id).sort(compareCanonicalStrings);
	const base = {
		regionId: input.regionId,
		scope: input.scope,
		reason: input.reason,
		endpointIds: [...input.document.nodes, ...input.document.groups, ...input.document.junctions]
			.map(({ id }) => id)
			.sort(compareCanonicalStrings),
		relationIds,
	};
	if (input.status === RegionCompositionStatus.Unknown)
		return { ...base, status: input.status, ...input.provenance };
	return { ...base, status: input.status };
}

function failureEvidence(
	attempt: Extract<RegionLayoutAttempt, { status: RegionCompositionStatus.Unknown }>,
): RegionCompositionFailureEvidence {
	if (attempt.provenance !== undefined) return attempt;
	if (attempt.code !== undefined) return { code: attempt.code };
	return {};
}

function reasonFor(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function leafFailure(
	error: unknown,
	regionId: string,
	document: LogicDocument,
): RegionSubtreeFailure {
	if (error instanceof UnknownRegionLeafLayoutError) {
		return failure({
			status: RegionCompositionStatus.Unknown,
			regionId,
			scope: RegionSubtreeScope.Leaf,
			document,
			reason: error.reason,
			provenance: {
				...error.evidence,
				failureRegionId: error.regionId,
			},
		});
	}
	if (error instanceof UnsupportedRegionLeafLayoutError)
		return failure({
			status: RegionCompositionStatus.Unsupported,
			regionId,
			scope: RegionSubtreeScope.Leaf,
			document,
			reason: error.reason,
		});
	return failure({
		status: REGION_SUBTREE_CALCULATION_FAILED,
		regionId,
		scope: RegionSubtreeScope.Leaf,
		document,
		reason: reasonFor(error),
	});
}

function attemptLeaf(context: RecursiveContext, regionId: string): RegionSubtreeAttempt {
	const document = leafDocument(context, regionId);
	const measurements = nestedRegionLocalMeasurements(document, context.measurements);
	const definition = defined(context.model.regionsById.get(regionId)).definition;
	try {
		const solved = solveRegionLeafLayout({
			document,
			measurements,
			leafPolicy: regionLeafPolicy(definition),
			cache: context.cache,
		});
		return {
			status: RegionCompositionStatus.Selected,
			regionId,
			scope: RegionSubtreeScope.Leaf,
			document,
			layout: solved.layout,
			ranks: solved.ranks,
		};
	} catch (error) {
		return leafFailure(error, regionId, document);
	}
}

function attemptClosedSubtree(
	context: RecursiveContext,
	regionId: string,
	regionIds: ReadonlySet<string>,
	endpointIds: ReadonlySet<string>,
): RegionSubtreeAttempt {
	const document = subtreeDocument(context.graph, endpointIds);
	try {
		const graph = createGraph(document);
		if (!graph.ok)
			return failure({
				status: RegionCompositionStatus.Unsupported,
				regionId,
				scope: RegionSubtreeScope.ClosedSubtree,
				document,
				reason: graph.diagnostics.map(({ message }) => message).join('; '),
			});
		const measurements = nestedRegionLocalMeasurements(document, context.measurements);
		const attempt = solveNestedRegionLayoutForProjection(
			graph.value,
			measurements,
			subtreeInput(context.model, regionId, regionIds, endpointIds),
			defined(context.cache),
		);
		if (attempt.status === RegionCompositionStatus.Selected)
			return {
				status: RegionCompositionStatus.Selected,
				regionId,
				scope: RegionSubtreeScope.ClosedSubtree,
				document,
				layout: {
					...attempt.layout,
					regions: attempt.regions.map(({ id, bounds }) => ({ id, bounds })),
				},
			};
		if (attempt.status === RegionCompositionStatus.Unsupported)
			return failure({
				status: RegionCompositionStatus.Unsupported,
				regionId,
				scope: RegionSubtreeScope.ClosedSubtree,
				document,
				reason: attempt.reason,
			});
		let provenance: FailureProvenance = { ...failureEvidence(attempt) };
		if (attempt.regionId !== undefined)
			provenance = { ...provenance, failureRegionId: attempt.regionId };
		if (attempt.relationId !== undefined)
			provenance = { ...provenance, relationId: attempt.relationId };
		return failure({
			status: RegionCompositionStatus.Unknown,
			regionId,
			scope: RegionSubtreeScope.ClosedSubtree,
			document,
			reason: attempt.reason,
			provenance,
		});
	} catch (error) {
		return failure({
			status: REGION_SUBTREE_CALCULATION_FAILED,
			regionId,
			scope: RegionSubtreeScope.ClosedSubtree,
			document,
			reason: reasonFor(error),
		});
	}
}

/** Inspect the current source; publish only complete leaves and closed subtrees. */
export function solveRegionSubtreeAttempts({
	graph,
	measurements,
	input,
	cache,
}: RegionSubtreeAttemptInput): readonly RegionSubtreeAttempt[] {
	const normalized = normalizeRegionCompositionModel(graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready) return [];
	const model = normalized.model;
	const incidentLeaves = incidentLeafIds(model);
	const context: RecursiveContext = {
		graph,
		model,
		measurements,
		cache,
		ownershipByRelationId: new Map(model.relations.map((owned) => [owned.relation.id, owned])),
	};
	const coveredRegionIds = new Set<string>();
	const attempts: RegionSubtreeAttempt[] = [];
	for (const regionId of model.preorderIds) {
		if (coveredRegionIds.has(regionId)) continue;
		const region = defined(model.regionsById.get(regionId));
		if (region.childIds.length === 0) {
			if (!incidentLeaves.has(regionId)) attempts.push(attemptLeaf(context, regionId));
			continue;
		}
		if (regionId === model.rootId) continue;
		const regionIds = subtreeRegionIds(model, regionId);
		const endpointIds = subtreeEndpointIds(model, regionIds);
		if (!closedSubtree(model, endpointIds)) continue;
		const attempt = attemptClosedSubtree(context, regionId, regionIds, endpointIds);
		attempts.push(attempt);
		if (attempt.status === RegionCompositionStatus.Selected)
			regionIds.forEach((id) => coveredRegionIds.add(id));
	}
	return attempts;
}

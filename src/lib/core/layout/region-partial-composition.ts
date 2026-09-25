import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicDocument } from '../document/logic-document';
import { createGraph, type LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { BoundedSearchWitness } from './bounded-search';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import { solveNestedRegionLayoutForProjection } from './nested-region-layout';
import { nestedRegionLocalMeasurements } from './nested-region-local-measurements';
import { leafDocument, type RecursiveContext } from './nested-region-recursive-model-adapter';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from './region-composition-model';
import { RegionCompositionStatus, type RegionInput } from './region-composition-types';
import type { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';
import type { RegionIncidentUnknownCode } from './region-incident-contract';
import {
	solveRegionLeafLayout,
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-layout';
import { regionLeafPolicy } from './region-leaf-policy';
import type { RegionLocalLayoutCache } from './region-local-cache';
import {
	closedSubtree,
	incidentLeafIds,
	subtreeDocument,
	subtreeEndpointIds,
	subtreeInput,
	subtreeRegionIds,
} from './region-partial-composition-scope';

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

export interface RegionSubtreeFailure {
	readonly status:
		| RegionCompositionStatus.Unknown
		| RegionCompositionStatus.Unsupported
		| typeof REGION_SUBTREE_CALCULATION_FAILED;
	readonly regionId: string;
	readonly scope: RegionSubtreeScope;
	readonly reason: string;
	readonly code?: RegionGeometryDiagnosticCode | RegionIncidentUnknownCode | undefined;
	readonly failureRegionId?: string | undefined;
	readonly relationId?: string | undefined;
	readonly witness?: BoundedSearchWitness<unknown> | undefined;
	readonly endpointIds: readonly string[];
	readonly relationIds: readonly string[];
}

interface FailureProvenance {
	readonly code?: RegionGeometryDiagnosticCode | RegionIncidentUnknownCode | undefined;
	readonly failureRegionId?: string | undefined;
	readonly relationId?: string | undefined;
	readonly witness?: BoundedSearchWitness<unknown> | undefined;
}

export type RegionSubtreeAttempt =
	RegionLeafSubtreeSelected | RegionClosedSubtreeSelected | RegionSubtreeFailure;

export interface RegionSubtreeAttemptInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly input: RegionInput;
	readonly cache: RegionLocalLayoutCache;
}

interface FailureInput {
	readonly status: RegionSubtreeFailure['status'];
	readonly regionId: string;
	readonly scope: RegionSubtreeScope;
	readonly document: LogicDocument;
	readonly reason: string;
	readonly provenance?: FailureProvenance;
}

function failure({
	status,
	regionId,
	scope,
	document,
	reason,
	provenance = {},
}: FailureInput): RegionSubtreeFailure {
	return {
		status,
		regionId,
		scope,
		reason,
		...provenance,
		endpointIds: [...document.nodes, ...document.groups, ...document.junctions]
			.map(({ id }) => id)
			.sort(compareCanonicalStrings),
		relationIds: document.relations.map(({ id }) => id).sort(compareCanonicalStrings),
	};
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
				code: error.code,
				witness: error.witness,
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
		return failure({
			status: RegionCompositionStatus.Unknown,
			regionId,
			scope: RegionSubtreeScope.ClosedSubtree,
			document,
			reason: attempt.reason,
			provenance: {
				code: attempt.code,
				failureRegionId: attempt.regionId,
				relationId: attempt.relationId,
				witness: attempt.witness,
			},
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

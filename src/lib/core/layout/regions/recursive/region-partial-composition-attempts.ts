import { defined, type LogicDocument } from '../../../document/logic-document';
import { createGraph, type LogicGraph } from '../../../graph/create-graph';
import type { LayoutMeasurements, LayoutResult } from '../../layout-types';
import {
	indexRegionLeafDocuments,
	leafDocument,
	type RecursiveContext,
} from '../composition/nested-region-recursive-model-adapter';
import {
	type RegionCompositionDiagnostic,
	type RegionCompositionWork,
	RegionWorkLimitExceeded,
} from '../model/region-composition-limits';
import type { RegionCompositionModel } from '../model/region-composition-model';
import {
	RegionCompositionDiagnosticCode,
	RegionCompositionStatus,
	type RegionLayoutAttempt,
	RegionWorkPhase,
} from '../model/region-composition-types';
import { incidentEndpointPositions } from '../model/region-incident-contract';
import type { RegionLocalLayoutCache } from '../model/region-local-cache';
import type { RegionCompositionFailureEvidence } from '../model/region-search-evidence';
import { solveNestedRegionLayoutForProjection } from './nested-region-layout';
import { nestedRegionLocalMeasurements } from './nested-region-local-measurements';
import {
	closedSubtree,
	indexRegionPartialComposition,
	type RegionPartialCompositionIndex,
	subtreeDocument,
	subtreeEndpointIds,
	subtreeInput,
	subtreeRegionIds,
} from './region-partial-composition-scope';
import {
	REGION_SUBTREE_CALCULATION_FAILED,
	type RegionSubtreeAttempt,
	type RegionSubtreeFailure,
	type RegionSubtreeFailureInput,
	type RegionSubtreeScope,
} from './region-partial-composition-types';

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

type LeafAttempt = (
	context: RecursiveContext,
	regionId: string,
	document: LogicDocument,
	work: RegionCompositionWork,
) => RegionSubtreeAttempt;

type FailureProvenance = RegionCompositionFailureEvidence & {
	readonly failureRegionId?: string | undefined;
	readonly relationId?: string | undefined;
};

interface AttemptScopes {
	readonly leaf: RegionSubtreeScope.Leaf;
	readonly closedSubtree: RegionSubtreeScope.ClosedSubtree;
}

interface ClosedSubtreeAttemptInput {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly regionIds: readonly string[];
	readonly endpointIds: readonly string[];
	readonly document: LogicDocument;
	readonly work: RegionCompositionWork;
	readonly scopes: AttemptScopes;
	readonly makeFailure: (input: RegionSubtreeFailureInput) => RegionSubtreeFailure;
}

function attemptClosedSubtree({
	context,
	regionId,
	regionIds,
	endpointIds,
	document,
	work,
	scopes,
	makeFailure,
}: ClosedSubtreeAttemptInput): RegionSubtreeAttempt {
	try {
		for (const node of document.nodes) {
			work.charge(RegionWorkPhase.Traversals, node.id);
		}
		for (const group of document.groups) {
			work.charge(RegionWorkPhase.Traversals, group.id);
		}
		for (const junction of document.junctions) {
			work.charge(RegionWorkPhase.Traversals, junction.id);
		}
		for (const relation of document.relations) work.charge(RegionWorkPhase.Traversals, relation.id);
		const graph = createGraph(document);
		if (!graph.ok)
			return makeFailure({
				status: RegionCompositionStatus.Unsupported,
				regionId,
				scope: scopes.closedSubtree,
				document,
				reason: graph.diagnostics.map(({ message }) => message).join('; '),
			});
		const measurements = nestedRegionLocalMeasurements(document, context.measurements);
		const attempt = solveNestedRegionLayoutForProjection(
			graph.value,
			measurements,
			subtreeInput(context.model, regionIds, endpointIds, work),
			{ cache: defined(context.cache), work },
		);
		if (attempt.status === RegionCompositionStatus.Selected) {
			const regions: NonNullable<LayoutResult['regions']>[number][] = [];
			for (const region of attempt.regions) {
				work.charge(RegionWorkPhase.Traversals, region.id);
				regions.push({ id: region.id, bounds: region.bounds });
			}
			return {
				status: RegionCompositionStatus.Selected,
				regionId,
				scope: scopes.closedSubtree,
				document,
				layout: { ...attempt.layout, regions },
			};
		}
		if (attempt.status === RegionCompositionStatus.Unsupported)
			return makeFailure({
				status: RegionCompositionStatus.Unsupported,
				regionId,
				scope: scopes.closedSubtree,
				document,
				reason: attempt.reason,
				diagnostic: attempt.diagnostic,
			});
		let provenance: FailureProvenance = { ...failureEvidence(attempt) };
		if (attempt.regionId !== undefined)
			provenance = { ...provenance, failureRegionId: attempt.regionId };
		if (attempt.relationId !== undefined)
			provenance = { ...provenance, relationId: attempt.relationId };
		return makeFailure({
			status: RegionCompositionStatus.Unknown,
			regionId,
			scope: scopes.closedSubtree,
			document,
			reason: attempt.reason,
			provenance,
		});
	} catch (error) {
		if (error instanceof RegionWorkLimitExceeded) throw error;
		return makeFailure({
			status: REGION_SUBTREE_CALCULATION_FAILED,
			regionId,
			scope: scopes.closedSubtree,
			document,
			reason: reasonFor(error),
		});
	}
}

interface TraversalProgress {
	regionId: string;
	scope: RegionSubtreeScope;
	document: LogicDocument;
}

interface TraversalContext {
	readonly context: RecursiveContext;
	readonly index: RegionPartialCompositionIndex;
	readonly work: RegionCompositionWork;
	readonly scopes: AttemptScopes;
	readonly attempts: RegionSubtreeAttempt[];
	readonly coveredRegionIds: Set<string>;
	readonly progress: TraversalProgress;
	readonly attemptLeaf: LeafAttempt;
	readonly makeFailure: (input: RegionSubtreeFailureInput) => RegionSubtreeFailure;
}

function isResourceLimitFailure(attempt: RegionSubtreeAttempt): boolean {
	return (
		attempt.status === RegionCompositionStatus.Unsupported &&
		attempt.diagnostic?.code === RegionCompositionDiagnosticCode.ResourceLimit
	);
}

function attemptRegion(regionId: string, traversal: TraversalContext): boolean {
	const { context, index, work, scopes, attempts, coveredRegionIds, progress } = traversal;
	const model = context.model;
	const region = defined(model.regionsById.get(regionId));
	progress.regionId = regionId;
	if (region.childIds.length === 0) progress.scope = scopes.leaf;
	else progress.scope = scopes.closedSubtree;
	progress.document = context.graph.document;
	work.charge(RegionWorkPhase.Traversals, regionId);
	if (coveredRegionIds.has(regionId)) return false;
	if (region.childIds.length === 0) {
		if (index.incidentLeafIds.has(regionId)) return false;
		const document = leafDocument(context, regionId);
		progress.document = document;
		const attempt = traversal.attemptLeaf(context, regionId, document, work);
		attempts.push(attempt);
		return isResourceLimitFailure(attempt);
	}
	if (regionId === model.rootId || !closedSubtree(index, regionId)) return false;
	const regionIds = subtreeRegionIds(model, index, regionId, work);
	const endpointIds = subtreeEndpointIds(index, regionIds, work, regionId);
	const document = subtreeDocument(context.graph, index, regionIds, work);
	progress.document = document;
	const attempt = attemptClosedSubtree({
		context,
		regionId,
		regionIds,
		endpointIds,
		document,
		work,
		scopes,
		makeFailure: traversal.makeFailure,
	});
	attempts.push(attempt);
	if (isResourceLimitFailure(attempt)) return true;
	if (attempt.status === RegionCompositionStatus.Selected)
		for (const id of regionIds) {
			work.charge(RegionWorkPhase.Traversals, id);
			coveredRegionIds.add(id);
		}
	return false;
}

interface PartialCompositionAttemptInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly model: RegionCompositionModel;
	readonly cache: RegionLocalLayoutCache;
	readonly work: RegionCompositionWork;
	readonly scopes: AttemptScopes;
	readonly makeFailure: (input: RegionSubtreeFailureInput) => RegionSubtreeFailure;
	readonly resourceLimitFailure: (
		diagnostic: RegionCompositionDiagnostic,
		regionId: string,
		scope: RegionSubtreeScope,
		document: LogicDocument,
	) => RegionSubtreeFailure;
	readonly attemptLeaf: LeafAttempt;
}

export function runRegionPartialCompositionAttempts({
	graph,
	measurements,
	model,
	cache,
	work,
	scopes,
	makeFailure,
	resourceLimitFailure,
	attemptLeaf,
}: PartialCompositionAttemptInput): readonly RegionSubtreeAttempt[] {
	const attempts: RegionSubtreeAttempt[] = [];
	const progress: TraversalProgress = {
		regionId: model.rootId,
		scope: scopes.closedSubtree,
		document: graph.document,
	};
	try {
		const leafDocuments = indexRegionLeafDocuments(graph, model, work);
		const index = indexRegionPartialComposition(graph, model, work);
		const context: RecursiveContext = {
			graph,
			model,
			measurements,
			cache,
			endpointPositions: incidentEndpointPositions(graph.document),
			ownershipByRelationId: index.ownershipByRelationId,
			leafDocuments,
		};
		const traversal: TraversalContext = {
			context,
			index,
			work,
			scopes,
			attempts,
			coveredRegionIds: new Set<string>(),
			progress,
			makeFailure,
			attemptLeaf,
		};
		for (const regionId of model.preorderIds) {
			if (attemptRegion(regionId, traversal)) break;
		}
	} catch (error) {
		if (!(error instanceof RegionWorkLimitExceeded)) throw error;
		attempts.push(
			resourceLimitFailure(error.diagnostic, progress.regionId, progress.scope, progress.document),
		);
	}
	return attempts;
}

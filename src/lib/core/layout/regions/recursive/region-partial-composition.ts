import { compareCanonicalStrings } from '../../../canonical-string';
import { defined, type LogicDocument } from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import type { LayoutMeasurements } from '../../layout-types';
import type { RecursiveContext } from '../composition/nested-region-recursive-model-adapter';
import {
	solveRegionLeafLayout,
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from '../leaf/region-leaf-layout';
import { regionLeafPolicy } from '../leaf/region-leaf-policy';
import {
	type RegionCompositionDiagnostic,
	RegionCompositionWork,
	regionCompositionWorkBudgets,
	RegionWorkLimitExceeded,
} from '../model/region-composition-limits';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../model/region-composition-model';
import {
	RegionCompositionDiagnosticCode,
	RegionCompositionStatus,
	type RegionInput,
	RegionWorkPhase,
} from '../model/region-composition-types';
import type { RegionLocalLayoutCache } from '../model/region-local-cache';
import { nestedRegionLocalMeasurements } from './nested-region-local-measurements';
import { runRegionPartialCompositionAttempts } from './region-partial-composition-attempts';
import {
	REGION_SUBTREE_CALCULATION_FAILED,
	type RegionSubtreeAttempt,
	type RegionSubtreeFailure,
	type RegionSubtreeFailureInput,
	RegionSubtreeScope,
} from './region-partial-composition-types';

export interface RegionSubtreeAttemptInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly input: RegionInput;
	readonly cache: RegionLocalLayoutCache;
	readonly work?: RegionCompositionWork | undefined;
}

/** Convert internal attempt diagnostics into stable partial-composition evidence. */
function failure(input: RegionSubtreeFailureInput): RegionSubtreeFailure {
	let diagnostic: RegionCompositionDiagnostic | undefined;
	if ('diagnostic' in input) diagnostic = input.diagnostic;
	const resourceLimited = diagnostic?.code === RegionCompositionDiagnosticCode.ResourceLimit;
	let relationIds: string[] = [];
	let endpointIds: string[] = [];
	if (!resourceLimited) {
		relationIds = input.document.relations.map(({ id }) => id);
		endpointIds = [
			...input.document.nodes,
			...input.document.groups,
			...input.document.junctions,
		].map(({ id }) => id);
		relationIds.sort(compareCanonicalStrings);
		endpointIds.sort(compareCanonicalStrings);
	}
	const base = {
		regionId: input.regionId,
		scope: input.scope,
		reason: input.reason,
		endpointIds,
		relationIds,
	};
	if (diagnostic !== undefined) Object.assign(base, { diagnostic });
	if (input.status === RegionCompositionStatus.Unknown)
		return { ...base, status: input.status, ...input.provenance };
	return { ...base, status: input.status };
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

function attemptLeaf(
	context: RecursiveContext,
	regionId: string,
	document: LogicDocument,
	work: RegionCompositionWork,
): RegionSubtreeAttempt {
	for (const node of document.nodes) work.charge(RegionWorkPhase.Traversals, node.id);
	for (const group of document.groups) work.charge(RegionWorkPhase.Traversals, group.id);
	for (const junction of document.junctions) work.charge(RegionWorkPhase.Traversals, junction.id);
	for (const relation of document.relations) work.charge(RegionWorkPhase.Traversals, relation.id);
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
		if (error instanceof RegionWorkLimitExceeded) throw error;
		return leafFailure(error, regionId, document);
	}
}

function resourceLimitFailure(
	diagnostic: RegionCompositionDiagnostic,
	regionId: string,
	scope: RegionSubtreeScope,
	document: LogicDocument,
): RegionSubtreeFailure {
	return failure({
		status: RegionCompositionStatus.Unsupported,
		regionId,
		scope,
		document,
		reason: diagnostic.message,
		diagnostic,
	});
}

function normalizationLimitFailure(
	input: RegionInput,
	graph: LogicGraph,
	diagnostic: RegionCompositionDiagnostic,
): RegionSubtreeFailure {
	return resourceLimitFailure(
		diagnostic,
		diagnostic.ownerId ?? input.regions[0]?.id ?? '@root',
		RegionSubtreeScope.ClosedSubtree,
		graph.document,
	);
}

/** Inspect the current source; publish only complete leaves and closed subtrees. */
export function solveRegionSubtreeAttempts({
	graph,
	measurements,
	input,
	cache,
	work: suppliedWork,
}: RegionSubtreeAttemptInput): readonly RegionSubtreeAttempt[] {
	const work =
		suppliedWork ??
		new RegionCompositionWork(
			regionCompositionWorkBudgets(input.regions.length, graph.relations.length),
		);
	const normalized = normalizeRegionCompositionModel(graph, input, work);
	if (normalized.status !== RegionCompositionModelStatus.Ready) {
		if (
			normalized.status === RegionCompositionModelStatus.Unsupported &&
			normalized.diagnostic.code === RegionCompositionDiagnosticCode.ResourceLimit
		)
			return [normalizationLimitFailure(input, graph, normalized.diagnostic)];
		return [];
	}
	return runRegionPartialCompositionAttempts({
		graph,
		measurements,
		model: normalized.model,
		cache,
		work,
		scopes: {
			leaf: RegionSubtreeScope.Leaf,
			closedSubtree: RegionSubtreeScope.ClosedSubtree,
		},
		makeFailure: failure,
		resourceLimitFailure,
		attemptLeaf,
	});
}

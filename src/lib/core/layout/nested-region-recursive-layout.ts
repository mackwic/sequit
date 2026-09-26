import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { RouteBridgeCache } from './bridges/bridge-oracle';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import { validateNestedRegionLeafIncidents } from './nested-region-leaf-incident-validation';
import { nestedRegionLocalMeasurements } from './nested-region-local-measurements';
import { regionQualifiedFailure } from './nested-region-recursive-diagnostics';
import type { RegionIncidentPath, SolvedRecursiveRegion } from './nested-region-recursive-geometry';
import {
	type IncidentSides,
	leafDocument,
	leafIncidentContracts,
	policyFailure,
	type RecursiveContext,
} from './nested-region-recursive-model-adapter';
import { solveArrangedRegion } from './region-arrangement-orchestration';
import { regionArrangementFor } from './region-arrangement-selection';
import { NESTED_REGION_COMPOSITION_LIMITS } from './region-composition-limits';
import {
	normalizeRegionCompositionModel,
	type RegionCompositionModel,
	RegionCompositionModelStatus,
} from './region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutAttempt,
	type RegionPortalSide,
} from './region-composition-types';
import { validateRegionCompositionGeometry } from './region-composition-validation';
import { regionLeafIncidentPath } from './region-leaf-incident-path';
import {
	solveRegionLeafLayoutWithIncidents,
	UnknownRegionLeafLayoutError,
} from './region-leaf-layout';
import { regionLeafPolicy } from './region-leaf-policy';
import type { RegionLocalLayoutCache } from './region-local-cache';
import {
	type DiagnosedCandidate,
	diagnosedFailure,
	leafErrorAttempt,
	type RegionRetryState,
	retryIncidentFailure,
	retryLeafContractFailure,
} from './region-recursive-outcome';
import { RegionSearchProvenance } from './region-search-evidence';

function solveLeaf(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
): SolvedRecursiveRegion {
	const document = leafDocument(context, regionId);
	const measurements = nestedRegionLocalMeasurements(document, context.measurements);
	const definition = defined(context.model.regionsById.get(regionId)).definition;
	const solved = solveRegionLeafLayoutWithIncidents({
		document,
		measurements,
		leafPolicy: regionLeafPolicy(definition),
		cache: context.cache,
		contracts: leafIncidentContracts(context, regionId, incidentSides),
	});
	if (solved.status === RegionCompositionStatus.Unknown)
		throw new UnknownRegionLeafLayoutError(
			`Region ${regionId}: ${solved.reason}`,
			{ provenance: RegionSearchProvenance.Incident, code: solved.code, witness: solved.witness },
			regionId,
		);
	const ranks = solved.ranks;
	const labels = new Map(document.presentation?.lanes.map(({ id, label }) => [id, label]) ?? []);
	let layout: LayoutResult = solved.layout;
	if (document.presentation !== undefined && solved.layout.lanes !== undefined)
		layout = {
			...solved.layout,
			lanes: solved.layout.lanes.map((lane) => ({
				...lane,
				regionId,
				label: defined(labels.get(lane.id)),
			})),
		};
	const incidentPaths = new Map<string, RegionIncidentPath>();
	for (const incident of solved.incidents)
		incidentPaths.set(incident.relationId, regionLeafIncidentPath(regionId, layout, incident));
	return {
		layout,
		ranks,
		regions: [],
		portals: [],
		ownedRoutes: layout.relations.map((relation) => ({
			relationId: relation.id,
			regionId,
			points: relation.points,
		})),
		incidentPaths,
	};
}

function solveRegion(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
): SolvedRecursiveRegion {
	const region = defined(context.model.regionsById.get(regionId));
	const arrangement = regionArrangementFor(region);
	if (arrangement === undefined) return solveLeaf(context, regionId, incidentSides);
	return solveArrangedRegion({
		context,
		regionId,
		incidentSides,
		arrangement,
		solveChild: solveRegion,
	});
}

interface RecursiveCandidateInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly model: RegionCompositionModel;
	readonly cache: RegionLocalLayoutCache | undefined;
}

function retryCompositionFailure(
	state: RegionRetryState,
	failure: ReturnType<typeof validateRegionCompositionGeometry>,
): boolean {
	if (failure === undefined) return false;
	return retryIncidentFailure(state, failure);
}

function solveRecursiveCandidate(input: RecursiveCandidateInput): DiagnosedCandidate {
	const { graph, measurements, model, cache } = input;
	const dispositionSideByRegionId = new Map<string, RegionPortalSide>();
	const context: RecursiveContext = {
		graph,
		measurements,
		cache,
		model,
		ownershipByRelationId: new Map(model.relations.map((owned) => [owned.relation.id, owned])),
		dispositionSideByRegionId,
	};
	const relationOrder = new Map(graph.relations.map(({ relation }, index) => [relation.id, index]));
	const retriedOwners = new Set<string>();
	const retryState: RegionRetryState = {
		context,
		retriedOwners,
		dispositionSides: dispositionSideByRegionId,
	};
	// One initial candidate plus at most one side retry per normalized region.
	const retryBudget = model.regionsById.size + 1;
	for (let attempt = 0; attempt < retryBudget; attempt += 1) {
		let solved: SolvedRecursiveRegion;
		try {
			solved = solveRegion(context, model.rootId, new Map());
		} catch (error) {
			if (retryLeafContractFailure(retryState, error)) continue;
			throw error;
		}
		const candidate = {
			status: RegionCompositionStatus.Selected,
			rootId: model.rootId,
			layout: solved.layout,
			regions: solved.regions,
			portals: [...solved.portals].sort(
				(left, right) =>
					defined(relationOrder.get(left.relationId)) -
					defined(relationOrder.get(right.relationId)),
			),
			ownedRoutes: solved.ownedRoutes,
		} as const;
		const bridgeCache: RouteBridgeCache = {};
		const chainFailure = validateRegionCompositionGeometry(model, candidate, bridgeCache);
		if (retryCompositionFailure(retryState, chainFailure)) continue;
		if (chainFailure !== undefined) return diagnosedFailure(chainFailure, chainFailure.message);
		const incidentFailure = validateNestedRegionLeafIncidents(model, candidate, bridgeCache);
		if (incidentFailure !== undefined) {
			if (retryIncidentFailure(retryState, incidentFailure)) continue;
			return diagnosedFailure(incidentFailure, regionQualifiedFailure(model, incidentFailure));
		}
		return { attempt: candidate };
	}
	throw new Error('Region side alternatives exceeded the normalized region count.');
}

/** A row disposition with an incident contract at every region boundary. */
export function solveRecursiveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: RegionInput,
	cache?: RegionLocalLayoutCache,
): RegionLayoutAttempt {
	const normalized = normalizeRegionCompositionModel(
		graph,
		input,
		NESTED_REGION_COMPOSITION_LIMITS,
	);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		return {
			status: RegionCompositionStatus.Unsupported,
			reason: normalized.diagnostic.message,
		};
	const failure = policyFailure(graph, normalized.model);
	if (failure !== undefined)
		return { status: RegionCompositionStatus.Unsupported, reason: failure };
	try {
		return solveRecursiveCandidate({
			graph,
			measurements,
			model: normalized.model,
			cache,
		}).attempt;
	} catch (error) {
		const attempt = leafErrorAttempt(error);
		if (attempt !== undefined) return attempt;
		throw error;
	}
}

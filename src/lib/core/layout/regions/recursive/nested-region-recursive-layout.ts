import { defined } from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import type { LayoutMeasurements, LayoutResult } from '../../layout-types';
import type {
	RegionIncidentPath,
	SolvedRecursiveRegion,
} from '../composition/nested-region-recursive-geometry';
import {
	type IncidentSides,
	leafDocument,
	leafIncidentContracts,
	policyFailure,
	type RecursiveContext,
} from '../composition/nested-region-recursive-model-adapter';
import { regionLeafIncidentPath } from '../leaf/region-leaf-incident-path';
import {
	enumerateRegionLeafLayoutsWithIncidents,
	type RegionLeafIncidentAttempt,
	type RegionLeafIncidentInput,
	solveRegionLeafLayoutWithIncidents,
	UnknownRegionLeafLayoutError,
} from '../leaf/region-leaf-layout';
import { regionLeafPolicy } from '../leaf/region-leaf-policy';
import {
	checkRegionStackDepth,
	RegionCompositionWork,
	regionCompositionWorkBudgets,
	RegionWorkLimitExceeded,
} from '../model/region-composition-limits';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutAttempt,
} from '../model/region-composition-types';
import type { RegionLocalLayoutCache } from '../model/region-local-cache';
import { RegionSearchProvenance } from '../model/region-search-evidence';
import { nestedRegionLocalMeasurements } from './nested-region-local-measurements';
import { solveArrangedRegion } from './region-arrangement-orchestration';
import { regionArrangementFor } from './region-arrangement-selection';
import {
	ExhaustedLeafAlternative,
	type LeafSelection,
	leafStreamCandidate,
	solveRecursiveCandidate,
} from './region-composition-search';
import { leafErrorAttempt } from './region-recursive-outcome';

function leafCandidate(
	input: RegionLeafIncidentInput,
	regionId: string,
	selection: LeafSelection | undefined,
): RegionLeafIncidentAttempt {
	const index = selection?.indices.get(regionId);
	if (index === undefined) return solveRegionLeafLayoutWithIncidents(input);
	const streams = defined(selection);
	let stream = streams.streams.get(regionId);
	if (stream === undefined) {
		stream = {
			candidates: [],
			iterator: enumerateRegionLeafLayoutsWithIncidents(input),
			exhaustive: false,
			complete: true,
		};
		streams.streams.set(regionId, stream);
	}
	const candidate = leafStreamCandidate(stream, index);
	if (candidate !== undefined) return candidate;
	if (index > 0) throw new ExhaustedLeafAlternative();
	return solveRegionLeafLayoutWithIncidents(input);
}

function solveLeaf(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
	selection?: LeafSelection,
): SolvedRecursiveRegion {
	const index = selection?.indices.get(regionId) ?? -1;
	const cached = selection?.solvedLeaves.get(regionId)?.get(index);
	if (cached !== undefined) return cached;
	const document = leafDocument(context, regionId);
	const measurements = nestedRegionLocalMeasurements(document, context.measurements);
	const definition = defined(context.model.regionsById.get(regionId)).definition;
	const input = {
		document,
		measurements,
		leafPolicy: regionLeafPolicy(definition),
		cache: context.cache,
		contracts: leafIncidentContracts(context, regionId, incidentSides),
	};
	const solved = leafCandidate(input, regionId, selection);
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
	const result: SolvedRecursiveRegion = {
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
	if (selection !== undefined) {
		let layouts = selection.solvedLeaves.get(regionId);
		if (layouts === undefined) {
			layouts = new Map();
			selection.solvedLeaves.set(regionId, layouts);
		}
		layouts.set(index, result);
	}
	return result;
}

interface RegionSolveState {
	readonly selection?: LeafSelection | undefined;
	readonly work: RegionCompositionWork;
}

function solveRegion(
	context: RecursiveContext,
	regionId: string,
	incidentSides: IncidentSides,
	state: RegionSolveState,
): SolvedRecursiveRegion {
	const region = defined(context.model.regionsById.get(regionId));
	const arrangement = regionArrangementFor(region);
	if (arrangement === undefined)
		return solveLeaf(context, regionId, incidentSides, state.selection);
	return solveArrangedRegion({
		context,
		regionId,
		incidentSides,
		arrangement,
		work: state.work,
		solveChild: (childContext, id, sides) => solveRegion(childContext, id, sides, state),
	});
}

/** A row disposition with an incident contract at every region boundary. */
export function solveRecursiveNestedRegionLayout(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: RegionInput,
	cache?: RegionLocalLayoutCache,
): RegionLayoutAttempt {
	return solveRecursiveNestedRegionLayoutWithWork(graph, measurements, input, { cache });
}

/** An invocation can supply counters to inspect measured work and exercise a budget boundary. */
export function solveRecursiveNestedRegionLayoutWithWork(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	input: RegionInput,
	execution: {
		readonly cache?: RegionLocalLayoutCache | undefined;
		readonly work?: RegionCompositionWork;
	} = {},
): RegionLayoutAttempt {
	const { cache } = execution;
	const work =
		execution.work ??
		new RegionCompositionWork(
			regionCompositionWorkBudgets(input.regions.length, graph.relations.length),
		);
	const normalized = normalizeRegionCompositionModel(graph, input, work);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		return {
			status: RegionCompositionStatus.Unsupported,
			reason: normalized.diagnostic.message,
			diagnostic: normalized.diagnostic,
		};
	const stack = checkRegionStackDepth(normalized.model.preorderIds, normalized.model.regionsById);
	if (stack !== undefined)
		return {
			status: RegionCompositionStatus.Unsupported,
			reason: stack.message,
			diagnostic: stack,
		};
	try {
		const failure = policyFailure(graph, normalized.model, work);
		if (failure !== undefined)
			return { status: RegionCompositionStatus.Unsupported, reason: failure };
		return solveRecursiveCandidate(
			{
				graph,
				measurements,
				model: normalized.model,
				cache,
			},
			(context, selection) =>
				solveRegion(context, normalized.model.rootId, new Map(), { selection, work }),
			work,
		).attempt;
	} catch (error) {
		if (error instanceof RegionWorkLimitExceeded)
			return {
				status: RegionCompositionStatus.Unsupported,
				reason: error.message,
				diagnostic: error.diagnostic,
			};
		const attempt = leafErrorAttempt(error);
		if (attempt !== undefined) return attempt;
		throw error;
	}
}

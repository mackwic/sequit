import { defined } from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import { type RouteBridgeCache, validatedBridgesCached } from '../../bridges/bridge-oracle';
import type { RegionGeometryDiagnostic } from '../../geometry/region-geometry-diagnostic';
import type { LayoutMeasurements } from '../../layout-types';
import type { SolvedRecursiveRegion } from '../composition/nested-region-recursive-geometry';
import type { RecursiveContext } from '../composition/nested-region-recursive-model-adapter';
import {
	betterCompositionCost,
	chooseCompositionIssue,
	type CompositionCostCandidate,
	compositionCostCandidate,
} from '../leaf/region-composition-cost';
import {
	type enumerateRegionLeafLayoutsWithIncidents,
	type RegionLeafIncidentSelected,
	UnknownRegionLeafLayoutError,
} from '../leaf/region-leaf-layout';
import type { RegionCompositionModel } from '../model/region-composition-model';
import {
	type RegionCompositionSearchWitness,
	RegionCompositionStatus,
	type RegionLayoutSelected,
	type RegionPortalSide,
} from '../model/region-composition-types';
import type { RegionLocalLayoutCache } from '../model/region-local-cache';
import { validateNestedRegionLeafIncidents } from '../validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometry } from '../validation/region-composition-validation';
import { regionQualifiedFailure } from './nested-region-recursive-diagnostics';
import { incidentLeafIds, indexVectors } from './region-composition-product';
import {
	type DiagnosedCandidate,
	diagnosedFailure,
	type RegionRetryState,
	retryIncidentFailure,
	retryLeafContractFailure,
} from './region-recursive-outcome';

interface LeafStream {
	readonly candidates: RegionLeafIncidentSelected[];
	readonly iterator: ReturnType<typeof enumerateRegionLeafLayoutsWithIncidents>;
	exhaustive: boolean;
	complete: boolean;
}

export interface LeafSelection {
	readonly indices: Map<string, number>;
	readonly streams: Map<string, LeafStream>;
	readonly solvedLeaves: Map<string, Map<number, SolvedRecursiveRegion>>;
}

export class ExhaustedLeafAlternative extends Error {}

export interface RecursiveCandidateInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly model: RegionCompositionModel;
	readonly cache: RegionLocalLayoutCache | undefined;
}

interface SearchState {
	attempted: number;
	exhaustive: boolean;
	bestDetour?: CompositionCostCandidate;
	bestBridge?: CompositionCostCandidate;
	firstFailure?: DiagnosedCandidate;
	readonly rejectedAlternatives: RegionCompositionSearchWitness['rejectedAlternatives'][number][];
}

interface PassInput {
	readonly input: RecursiveCandidateInput;
	readonly solveRoot: (
		context: RecursiveContext,
		selection: LeafSelection,
	) => SolvedRecursiveRegion;
	readonly leaves: readonly string[];
	readonly relationOrder: ReadonlyMap<string, number>;
	readonly wantsBridge: boolean;
	readonly state: SearchState;
	readonly firstSelection: LeafSelection;
}

interface SideResult {
	readonly truncated: boolean;
	readonly leafFailure?: UnknownRegionLeafLayoutError | undefined;
	readonly sideFailure?: RegionGeometryDiagnostic | undefined;
}

/** One budget shared by disposition retries and both bridge passes. */
const REGION_COMPOSITION_PRODUCT_BUDGET = 64;
const PASS_BUDGET = REGION_COMPOSITION_PRODUCT_BUDGET / 2;

function unavailableIndex(
	leaves: readonly string[],
	indices: readonly number[],
	selection: LeafSelection,
): boolean {
	for (const [offset, id] of leaves.entries()) {
		const stream = selection.streams.get(id);
		if (stream?.exhaustive === true && defined(indices[offset]) >= stream.candidates.length)
			return true;
	}
	return false;
}

function searchedAllIndices(
	leaves: readonly string[],
	diagonal: number,
	selection: LeafSelection,
): boolean {
	if (leaves.length === 0) return true;
	let maximum = 0;
	for (const id of leaves) {
		const stream = selection.streams.get(id);
		if (stream?.exhaustive !== true) return false;
		maximum += stream.candidates.length - 1;
	}
	return diagonal >= maximum;
}

function assembleCandidate(
	model: RegionCompositionModel,
	solved: SolvedRecursiveRegion,
	relationOrder: ReadonlyMap<string, number>,
): RegionLayoutSelected {
	return {
		status: RegionCompositionStatus.Selected,
		rootId: model.rootId,
		layout: solved.layout,
		regions: solved.regions,
		portals: [...solved.portals].sort(
			(left, right) =>
				defined(relationOrder.get(left.relationId)) - defined(relationOrder.get(right.relationId)),
		),
		ownedRoutes: solved.ownedRoutes,
	};
}

/** Only complete validated geometry enters either issue's incumbent. */
function evaluateCandidate(
	pass: PassInput,
	solved: SolvedRecursiveRegion,
	indices: readonly number[],
): RegionGeometryDiagnostic | undefined {
	const { model } = pass.input;
	const { state } = pass;
	const candidate = assembleCandidate(model, solved, pass.relationOrder);
	const bridgeCache: RouteBridgeCache = {};
	const chainFailure = validateRegionCompositionGeometry(model, candidate, bridgeCache);
	const failure = chainFailure ?? validateNestedRegionLeafIncidents(model, candidate, bridgeCache);
	if (failure !== undefined) {
		state.rejectedAlternatives.push({ indices: [...indices], code: failure.code });
		let reason = failure.message;
		if (chainFailure === undefined) reason = regionQualifiedFailure(model, failure);
		state.firstFailure ??= diagnosedFailure(failure, reason);
		return failure;
	}
	const hasBridge = validatedBridgesCached(candidate.layout.relations, bridgeCache).length > 0;
	if (hasBridge !== pass.wantsBridge) return undefined;
	const complete = compositionCostCandidate(candidate, indices);
	if (hasBridge) {
		if (state.bestBridge === undefined || betterCompositionCost(complete, state.bestBridge))
			state.bestBridge = complete;
	} else if (state.bestDetour === undefined || betterCompositionCost(complete, state.bestDetour))
		state.bestDetour = complete;
	return undefined;
}

function selectIndices(
	selection: LeafSelection,
	leaves: readonly string[],
	indices: readonly number[],
): void {
	selection.indices.clear();
	for (const [offset, id] of leaves.entries()) selection.indices.set(id, defined(indices[offset]));
}

interface SideSearchContext {
	readonly pass: PassInput;
	readonly context: RecursiveContext;
	readonly selection: LeafSelection;
	readonly passAttempts: { count: number };
}

interface ProductResult {
	readonly exhausted: boolean;
	readonly failure?: RegionGeometryDiagnostic;
	readonly leafFailure?: UnknownRegionLeafLayoutError;
}

function evaluateProduct(side: SideSearchContext, indices: readonly number[]): ProductResult {
	const { pass, context, selection, passAttempts } = side;
	selectIndices(selection, pass.leaves, indices);
	let solved: SolvedRecursiveRegion;
	try {
		solved = pass.solveRoot(context, selection);
	} catch (error) {
		if (error instanceof ExhaustedLeafAlternative) return { exhausted: true };
		if (error instanceof UnknownRegionLeafLayoutError)
			return { exhausted: false, leafFailure: error };
		throw error;
	}
	passAttempts.count += 1;
	pass.state.attempted += 1;
	const failure = evaluateCandidate(pass, solved, indices);
	if (failure !== undefined) return { exhausted: false, failure };
	return { exhausted: false };
}

function searchDiagonal(side: SideSearchContext, diagonal: number): SideResult {
	const { pass, selection, passAttempts } = side;
	let sideFailure: RegionGeometryDiagnostic | undefined;
	for (const indices of indexVectors(pass.leaves.length, diagonal)) {
		if (unavailableIndex(pass.leaves, indices, selection)) continue;
		if (passAttempts.count >= PASS_BUDGET) {
			pass.state.exhaustive = false;
			return { truncated: true };
		}
		const result = evaluateProduct(side, indices);
		if (result.exhausted) continue;
		if (result.leafFailure !== undefined)
			return { truncated: false, leafFailure: result.leafFailure };
		if (result.failure !== undefined) sideFailure = result.failure;
	}
	return { truncated: false, sideFailure };
}

function searchSide(
	pass: PassInput,
	context: RecursiveContext,
	passAttempts: { count: number },
	selection: LeafSelection,
): SideResult {
	const side: SideSearchContext = { pass, context, passAttempts, selection };
	let sideFailure: RegionGeometryDiagnostic | undefined;
	for (let diagonal = 0; diagonal <= PASS_BUDGET; diagonal += 1) {
		const result = searchDiagonal(side, diagonal);
		if (result.truncated || result.leafFailure !== undefined) return result;
		if (result.sideFailure !== undefined) sideFailure = result.sideFailure;
		if (searchedAllIndices(pass.leaves, diagonal, selection)) break;
	}
	for (const stream of selection.streams.values()) {
		if (stream.exhaustive && !stream.complete) pass.state.exhaustive = false;
	}
	return { truncated: false, sideFailure };
}

function noValidCandidate(state: SearchState): boolean {
	const hasIssue = state.bestDetour !== undefined || state.bestBridge !== undefined;
	return !hasIssue && state.firstFailure === undefined;
}

function newLeafSelection(): LeafSelection {
	return { indices: new Map(), streams: new Map(), solvedLeaves: new Map() };
}

function recordUnretriableLeaf(result: SideResult, state: SearchState): void {
	if (result.leafFailure === undefined) return;
	if (noValidCandidate(state)) throw result.leafFailure;
	state.exhaustive = false;
}

function searchPass(pass: PassInput): void {
	const { graph, measurements, cache, model } = pass.input;
	const dispositionSides = new Map<string, RegionPortalSide>();
	const context: RecursiveContext = {
		graph,
		measurements,
		cache,
		model,
		ownershipByRelationId: new Map(model.relations.map((owned) => [owned.relation.id, owned])),
		dispositionSideByRegionId: dispositionSides,
	};
	const retryState: RegionRetryState = { context, retriedOwners: new Set(), dispositionSides };
	const passAttempts = { count: 0 };
	for (let sideAttempt = 0; sideAttempt <= model.regionsById.size; sideAttempt += 1) {
		let selection = pass.firstSelection;
		if (sideAttempt > 0) selection = newLeafSelection();
		const result = searchSide(pass, context, passAttempts, selection);
		if (result.truncated) return;
		if (
			result.leafFailure !== undefined &&
			retryLeafContractFailure(retryState, result.leafFailure)
		)
			continue;
		if (result.sideFailure !== undefined && retryIncidentFailure(retryState, result.sideFailure))
			continue;
		recordUnretriableLeaf(result, pass.state);
		return;
	}
}

/** No candidate product or combination-dependent failure enters the leaf cache. */
export function solveRecursiveCandidate(
	input: RecursiveCandidateInput,
	solveRoot: PassInput['solveRoot'],
): DiagnosedCandidate {
	const leaves = incidentLeafIds(input.model);
	const relationOrder = new Map(
		input.graph.relations.map(({ relation }, index) => [relation.id, index]),
	);
	const state: SearchState = { attempted: 0, exhaustive: true, rejectedAlternatives: [] };
	const firstSelection = newLeafSelection();
	// Pass one rejects bridges, pass two admits them after the same complete validation.
	searchPass({
		input,
		solveRoot,
		leaves,
		relationOrder,
		wantsBridge: false,
		state,
		firstSelection,
	});
	searchPass({ input, solveRoot, leaves, relationOrder, wantsBridge: true, state, firstSelection });
	const issue = chooseCompositionIssue(state.bestDetour, state.bestBridge);
	let witness: RegionCompositionSearchWitness = {
		attempted: state.attempted,
		exhaustive: state.exhaustive,
		rejectedAlternatives: state.rejectedAlternatives,
		bestDetour: state.bestDetour?.cost,
		bestBridge: state.bestBridge?.cost,
		bestDetourIndices: state.bestDetour?.indices,
		bestBridgeIndices: state.bestBridge?.indices,
	};
	if (issue !== undefined) {
		witness = { ...witness, selected: issue.issue };
		let attempt = issue.selected.attempt;
		if (leaves.length > 0) attempt = { ...attempt, searchWitness: witness };
		return { attempt };
	}
	const failure = state.firstFailure?.attempt;
	if (failure?.status === RegionCompositionStatus.Unknown)
		return { attempt: { ...failure, searchWitness: witness } };
	return {
		attempt: {
			status: RegionCompositionStatus.Unknown,
			reason: 'No complete region candidate was found within the bounded product search.',
			searchWitness: witness,
		},
	};
}

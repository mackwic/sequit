import { defined } from '../../../document/logic-document';
import type { LogicGraph } from '../../../graph/create-graph';
import { type RouteBridgeCache, validatedBridgesCached } from '../../bridges/bridge-oracle';
import { indexVectors } from '../../geometry/index-vectors';
import type { RegionGeometryDiagnostic } from '../../geometry/region-geometry-diagnostic';
import type { LayoutMeasurements } from '../../layout-types';
import type { SolvedRecursiveRegion } from '../composition/nested-region-recursive-geometry';
import type { RecursiveContext } from '../composition/nested-region-recursive-model-adapter';
import { betterCompositionCost, compositionCostCandidate } from '../leaf/region-composition-cost';
import {
	type enumerateRegionLeafLayoutsWithIncidents,
	type RegionLeafIncidentSelected,
	UnknownRegionLeafLayoutError,
} from '../leaf/region-leaf-layout';
import type { RegionCompositionModel } from '../model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionLayoutSelected,
	type RegionPortalSide,
} from '../model/region-composition-types';
import type { RegionIncidentSearchWitness } from '../model/region-incident-contract';
import type { RegionLocalLayoutCache } from '../model/region-local-cache';
import { validateNestedRegionLeafIncidents } from '../validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometry } from '../validation/region-composition-validation';
import { regionQualifiedFailure } from './nested-region-recursive-diagnostics';
import { incidentLeafIds } from './region-composition-product';
import {
	compositionSearchOutcome,
	type DiagnosedCandidate,
	diagnosedFailure,
	type RegionRetryState,
	retryIncidentFailure,
	retryLeafContractFailure,
	type SearchState,
} from './region-recursive-outcome';

interface LeafStream {
	readonly candidates: RegionLeafIncidentSelected[];
	readonly iterator: ReturnType<typeof enumerateRegionLeafLayoutsWithIncidents>;
	exhaustive: boolean;
	complete: boolean;
	witness?: RegionIncidentSearchWitness;
}

export interface LeafSelection {
	readonly indices: Map<string, number>;
	readonly streams: Map<string, LeafStream>;
	readonly solvedLeaves: Map<string, Map<number, SolvedRecursiveRegion>>;
	readonly preserveFirst: boolean;
}

/** Pull only the local stream, never a composed geometry, when probing a product index. */
export function leafStreamCandidate(
	stream: LeafStream,
	index: number,
): RegionLeafIncidentSelected | undefined {
	while (stream.candidates.length <= index && !stream.exhaustive) {
		const next = stream.iterator.next();
		if (next.done === true) {
			stream.exhaustive = true;
			stream.complete = next.value.exhaustive;
			stream.witness = next.value;
		} else stream.candidates.push(next.value);
	}
	return stream.candidates[index];
}

export class ExhaustedLeafAlternative extends Error {}

export interface RecursiveCandidateInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly model: RegionCompositionModel;
	readonly cache: RegionLocalLayoutCache | undefined;
}

interface PassInput {
	readonly input: RecursiveCandidateInput;
	readonly solveRoot: (
		context: RecursiveContext,
		selection: LeafSelection,
	) => SolvedRecursiveRegion;
	readonly leaves: readonly string[];
	readonly relationOrder: ReadonlyMap<string, number>;
	readonly state: SearchState;
}

interface SideResult {
	readonly truncated: boolean;
	readonly leafFailure?: UnknownRegionLeafLayoutError | undefined;
	readonly sideFailure?: RegionGeometryDiagnostic | undefined;
	readonly historical?: boolean | undefined;
}

/** One budget shared by disposition retries and distinct complete compositions. */
const REGION_COMPOSITION_PRODUCT_BUDGET = 64;

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
	readonly historical?: boolean;
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
	const firstComplete = selection.preserveFirst && pass.state.attempted === 1;
	const initialVector = indices.every((index) => index === 0);
	return {
		exhausted: false,
		historical: firstComplete && initialVector && pass.state.bestDetour !== undefined,
	};
}

/** Ask for the next tuple without validating or charging a complete composition. */
function probeProduct(side: SideSearchContext, indices: readonly number[]): boolean {
	for (const [offset, id] of side.pass.leaves.entries()) {
		const stream = defined(side.selection.streams.get(id));
		if (leafStreamCandidate(stream, defined(indices[offset])) === undefined) return false;
	}
	return true;
}

function probeBeyondBudget(
	side: SideSearchContext,
	indices: readonly number[],
): SideResult | undefined {
	if (!probeProduct(side, indices)) return undefined;
	side.pass.state.exhaustive = false;
	side.pass.state.compositionBudgetExceeded = true;
	return { truncated: true };
}

function searchDiagonal(side: SideSearchContext, diagonal: number): SideResult {
	const { pass, selection, passAttempts } = side;
	let sideFailure: RegionGeometryDiagnostic | undefined;
	for (const indices of indexVectors(pass.leaves.length, diagonal, (dimension) => {
		const stream = selection.streams.get(defined(pass.leaves[dimension]));
		if (stream?.exhaustive === true) return stream.candidates.length - 1;
		return diagonal;
	})) {
		if (passAttempts.count >= REGION_COMPOSITION_PRODUCT_BUDGET) {
			const termination = probeBeyondBudget(side, indices);
			if (termination !== undefined) return termination;
			continue;
		}
		const result = evaluateProduct(side, indices);
		if (result.exhausted) continue;
		if (result.historical === true) {
			pass.state.exhaustive = false;
			return { truncated: false, historical: true };
		}
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
	for (let diagonal = 0; diagonal <= REGION_COMPOSITION_PRODUCT_BUDGET; diagonal += 1) {
		const result = searchDiagonal(side, diagonal);
		if (result.truncated || result.historical === true) return result;
		if (result.leafFailure !== undefined) return result;
		if (result.sideFailure !== undefined) sideFailure = result.sideFailure;
		if (searchedAllIndices(pass.leaves, diagonal, selection)) break;
	}
	for (const id of pass.leaves) {
		const stream = selection.streams.get(id);
		if (stream?.exhaustive === true && !stream.complete) {
			pass.state.exhaustive = false;
			pass.state.localBudget ??= { regionId: id, witness: defined(stream.witness) };
		}
	}
	return { truncated: false, sideFailure };
}

function newLeafSelection(preserveFirst: boolean): LeafSelection {
	return { indices: new Map(), streams: new Map(), solvedLeaves: new Map(), preserveFirst };
}

function recordUnretriableLeaf(result: SideResult, state: SearchState): void {
	if (result.leafFailure === undefined) return;
	state.leafFailure ??= result.leafFailure;
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
		const selection = newLeafSelection(sideAttempt === 0);
		const result = searchSide(pass, context, passAttempts, selection);
		if (result.truncated || result.historical === true) return;
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
	const state: SearchState = {
		attempted: 0,
		exhaustive: true,
		compositionBudgetExceeded: false,
		rejectedAlternatives: [],
	};
	searchPass({ input, solveRoot, leaves, relationOrder, state });
	return compositionSearchOutcome(state, leaves);
}

import { defined } from '../../../document/logic-document';
import type { RegionGeometryDiagnostic } from '../../geometry/region-geometry-diagnostic';
import {
	type RecursiveContext,
	sideForRegion,
} from '../composition/nested-region-recursive-model-adapter';
import {
	chooseCompositionIssue,
	type CompositionCostCandidate,
} from '../leaf/region-composition-cost';
import {
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from '../leaf/region-leaf-layout';
import type { RegionCompositionDiagnostic } from '../model/region-composition-limits';
import {
	type RegionCompositionSearchWitness,
	RegionCompositionStatus,
	type RegionLayoutAttempt,
	type RegionPortalSide,
} from '../model/region-composition-types';
import {
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from '../model/region-incident-contract';
import {
	RegionCompositionSearchCode,
	RegionSearchProvenance,
} from '../model/region-search-evidence';
import {
	retryOwnerForIncidentFailure,
	retryOwnerForLeafContractFailure,
} from './nested-region-recursive-diagnostics';
import { regionArrangementFor } from './region-arrangement-selection';

export interface DiagnosedCandidate {
	readonly attempt: RegionLayoutAttempt;
	readonly diagnostic?: RegionGeometryDiagnostic;
}

export interface RegionRetryState {
	readonly context: RecursiveContext;
	readonly retriedOwners: Set<string>;
	readonly dispositionSides: Map<string, RegionPortalSide>;
}

function nextRetrySide(state: RegionRetryState, ownerId: string): RegionPortalSide {
	const region = defined(state.context.model.regionsById.get(ownerId));
	const sides = defined(regionArrangementFor(region)).alternativeSides;
	const current = sideForRegion(state.context, ownerId);
	return defined(sides.find((side) => side !== current));
}

function retrySide(state: RegionRetryState, ownerId: string | undefined): boolean {
	if (ownerId === undefined || state.retriedOwners.has(ownerId)) return false;
	state.retriedOwners.add(ownerId);
	state.dispositionSides.set(ownerId, nextRetrySide(state, ownerId));
	return true;
}

export function retryLeafContractFailure(state: RegionRetryState, error: unknown): boolean {
	if (!(error instanceof UnknownRegionLeafLayoutError)) return false;
	const ownerId = retryOwnerForLeafContractFailure(state.context.model, error.evidence);
	return retrySide(state, ownerId);
}

export function retryIncidentFailure(
	state: RegionRetryState,
	diagnostic: RegionGeometryDiagnostic,
): boolean {
	const ownerId = retryOwnerForIncidentFailure(state.context.model, diagnostic);
	return retrySide(state, ownerId);
}

function failureProvenance(diagnostic: RegionGeometryDiagnostic): {
	readonly regionId?: string;
	readonly relationId?: string;
} {
	let provenance: { readonly regionId?: string; readonly relationId?: string } = {};
	if (diagnostic.regionId !== undefined)
		provenance = { ...provenance, regionId: diagnostic.regionId };
	if (diagnostic.relationId !== undefined)
		provenance = { ...provenance, relationId: diagnostic.relationId };
	return provenance;
}

export function diagnosedFailure(
	diagnostic: RegionGeometryDiagnostic,
	reason: string,
): DiagnosedCandidate {
	return {
		attempt: {
			status: RegionCompositionStatus.Unknown,
			code: diagnostic.code,
			reason,
			...failureProvenance(diagnostic),
		},
		diagnostic,
	};
}

export function leafErrorAttempt(error: unknown): RegionLayoutAttempt | undefined {
	if (error instanceof UnsupportedRegionLeafLayoutError)
		return {
			status: RegionCompositionStatus.Unsupported,
			reason: error.reason,
		};
	if (!(error instanceof UnknownRegionLeafLayoutError)) return undefined;
	let region: { readonly regionId?: string } = {};
	if (error.regionId !== undefined) region = { regionId: error.regionId };
	return {
		status: RegionCompositionStatus.Unknown,
		reason: error.reason,
		...error.evidence,
		...region,
	};
}

export interface SearchState {
	attempted: number;
	exhaustive: boolean;
	compositionBudgetExceeded: boolean;
	resourceLimit?: RegionCompositionDiagnostic;
	leafFailure?: UnknownRegionLeafLayoutError;
	localBudget?: { readonly regionId: string; readonly witness: RegionIncidentSearchWitness };
	bestDetour?: CompositionCostCandidate;
	bestBridge?: CompositionCostCandidate;
	firstFailure?: DiagnosedCandidate;
	readonly rejectedAlternatives: RegionCompositionSearchWitness['rejectedAlternatives'][number][];
}

export function compositionSearchOutcome(
	state: SearchState,
	leaves: readonly string[],
): DiagnosedCandidate {
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
	if (state.resourceLimit !== undefined)
		witness = { ...witness, resourceLimit: state.resourceLimit };
	if (issue !== undefined) {
		witness = { ...witness, selected: issue.issue };
		let attempt = issue.selected.attempt;
		if (leaves.length > 0) attempt = { ...attempt, searchWitness: witness };
		return { attempt };
	}
	if (state.compositionBudgetExceeded)
		return {
			attempt: {
				status: RegionCompositionStatus.Unknown,
				provenance: RegionSearchProvenance.Composition,
				code: RegionCompositionSearchCode.SearchBudgetExceeded,
				reason: 'The bounded region composition search exhausted its alternative budget.',
				searchWitness: witness,
			},
		};
	if (state.leafFailure !== undefined) {
		const error = state.leafFailure;
		let region: { readonly regionId?: string } = {};
		if (error.regionId !== undefined) region = { regionId: error.regionId };
		return {
			attempt: {
				status: RegionCompositionStatus.Unknown,
				reason: error.reason,
				...error.evidence,
				...region,
				searchWitness: witness,
			},
		};
	}
	if (state.localBudget !== undefined)
		return {
			attempt: {
				status: RegionCompositionStatus.Unknown,
				reason: `Region ${state.localBudget.regionId}: local leaf alternatives were not exhausted.`,
				provenance: RegionSearchProvenance.Incident,
				code: RegionIncidentUnknownCode.SearchBudgetExceeded,
				witness: state.localBudget.witness,
				regionId: state.localBudget.regionId,
				searchWitness: witness,
			},
		};
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

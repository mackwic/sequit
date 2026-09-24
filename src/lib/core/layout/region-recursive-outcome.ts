import { defined } from '../document/logic-document';
import {
	retryOwnerForIncidentFailure,
	retryOwnerForLeafContractFailure,
} from './nested-region-recursive-diagnostics';
import { type RecursiveContext, sideForRegion } from './nested-region-recursive-model-adapter';
import { regionArrangementFor } from './region-arrangement-selection';
import {
	RegionCompositionStatus,
	type RegionLayoutAttempt,
	type RegionPortalSide,
} from './region-composition-types';
import type { RegionGeometryDiagnostic } from './region-geometry-diagnostic';
import {
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-layout';

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
	const ownerId = retryOwnerForLeafContractFailure(state.context.model, error.code, error.witness);
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
		return { status: RegionCompositionStatus.Unsupported, reason: error.reason };
	if (!(error instanceof UnknownRegionLeafLayoutError)) return undefined;
	let code = {};
	let witness = {};
	let region = {};
	if (error.code !== undefined) code = { code: error.code };
	if (error.witness !== undefined) witness = { witness: error.witness };
	if (error.regionId !== undefined) region = { regionId: error.regionId };
	return {
		status: RegionCompositionStatus.Unknown,
		reason: error.reason,
		...code,
		...witness,
		...region,
	};
}

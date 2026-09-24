import {
	retryOwnerForIncidentFailure,
	retryOwnerForLeafContractFailure,
} from './nested-region-recursive-diagnostics';
import { type RecursiveContext, sideForRegion } from './nested-region-recursive-model-adapter';
import {
	NestedPortalSide,
	type NestedRegionLayoutAttempt,
	NestedRegionLayoutStatus,
} from './nested-region-types';
import type { RegionGeometryDiagnostic } from './region-geometry-diagnostic';
import {
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-layout';

export interface DiagnosedCandidate {
	readonly attempt: NestedRegionLayoutAttempt;
	readonly diagnostic?: RegionGeometryDiagnostic;
}

export interface RegionRetryState {
	readonly context: RecursiveContext;
	readonly retriedOwners: Set<string>;
	readonly dispositionSides: Map<string, NestedPortalSide>;
}

function alternateSide(side: NestedPortalSide): NestedPortalSide {
	if (side === NestedPortalSide.Top) return NestedPortalSide.Bottom;
	return NestedPortalSide.Top;
}

function retrySide(state: RegionRetryState, ownerId: string | undefined): boolean {
	if (ownerId === undefined || state.retriedOwners.has(ownerId)) return false;
	state.retriedOwners.add(ownerId);
	state.dispositionSides.set(ownerId, alternateSide(sideForRegion(state.context, ownerId)));
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
			status: NestedRegionLayoutStatus.Unknown,
			code: diagnostic.code,
			reason,
			...failureProvenance(diagnostic),
		},
		diagnostic,
	};
}

export function leafErrorAttempt(error: unknown): NestedRegionLayoutAttempt | undefined {
	if (error instanceof UnsupportedRegionLeafLayoutError)
		return { status: NestedRegionLayoutStatus.Unsupported, reason: error.reason };
	if (!(error instanceof UnknownRegionLeafLayoutError)) return undefined;
	let code = {};
	let witness = {};
	let region = {};
	if (error.code !== undefined) code = { code: error.code };
	if (error.witness !== undefined) witness = { witness: error.witness };
	if (error.regionId !== undefined) region = { regionId: error.regionId };
	return {
		status: NestedRegionLayoutStatus.Unknown,
		reason: error.reason,
		...code,
		...witness,
		...region,
	};
}

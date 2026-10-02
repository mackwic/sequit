import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import type { LogicDocument } from '../../../lib/core/document/logic-document';
import { GroupRouteFailure } from '../../../lib/core/layout/layout-types';
import {
	UnknownGridCellLayoutError,
	UnknownLayoutPresentationError,
	UnknownRegionLayoutError,
	UnsupportedGridCellLayoutError,
	UnsupportedLayoutPresentationError,
	UnsupportedRegionLayoutError,
} from '../../../lib/core/layout/root-region';
import { m } from '../i18n/paraglide/messages';
import { PartialRegionLayoutError, type RegionPreview } from './partial-region-layout';
import { UnresolvedFoldedGroupLayoutError } from './unresolved-folded-group-error';

/** Source facts that remain available when no geometry can be published. */
enum LayoutDiagnosticCode {
	LayoutFailed = 'layout-failed',
}

export enum LayoutFailureReasonCode {
	MissingNodeMeasurement = 'missing-node-measurement',
	MissingGroupMeasurement = 'missing-group-measurement',
	MissingJunctionMeasurement = 'missing-junction-measurement',
	RoutingConstraintCycle = 'routing-constraint-cycle',
	GroupPassage = 'group-route-no-valid-passage',
	UnsupportedLaneLayout = 'unsupported-lane-layout',
	UnknownLaneLayout = 'unknown-lane-layout',
	UnsupportedRegionLayout = 'unsupported-region-layout',
	UnknownRegionLayout = 'unknown-region-layout',
	UnknownFoldedGroupLayout = 'unknown-folded-group-layout',
	CalculationFailed = 'layout-calculation-failed',
}

interface LayoutFailureReason {
	readonly code: LayoutFailureReasonCode;
	readonly message: string;
	readonly elementId?: string;
	readonly relationId?: string;
}

export interface LayoutDiagnostic {
	readonly code: LayoutDiagnosticCode.LayoutFailed;
	readonly reason: LayoutFailureReason;
	readonly documentId: string;
	readonly title: string;
	readonly direction: LogicDocument['layout']['direction'];
	readonly nodeIds: readonly string[];
	readonly groupIds: readonly string[];
	readonly junctionIds: readonly string[];
	readonly relationIds: readonly string[];
}

function typedFailureReason(cause: unknown): LayoutFailureReason | undefined {
	if (cause instanceof GroupRouteFailure)
		return {
			code: LayoutFailureReasonCode.GroupPassage,
			relationId: cause.relationId,
			message: m.diagnostics_group_passage({ relationId: cause.relationId }),
		};
	if (cause instanceof UnsupportedGridCellLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnsupportedRegionLayout,
			message: m.diagnostics_unsupported_grid_layout(),
		};
	}
	if (cause instanceof UnknownGridCellLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnknownRegionLayout,
			message: m.diagnostics_unknown_grid_layout(),
		};
	}
	if (cause instanceof UnsupportedRegionLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnsupportedRegionLayout,
			message: m.diagnostics_unsupported_region_layout(),
		};
	}
	if (cause instanceof UnknownRegionLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnknownRegionLayout,
			message: m.diagnostics_unknown_region_layout(),
		};
	}
	return undefined;
}

function layoutFailureReason(document: LogicDocument, cause: unknown): LayoutFailureReason {
	const typedReason = typedFailureReason(cause);
	if (typedReason !== undefined) return typedReason;
	if (cause instanceof UnsupportedLayoutPresentationError) {
		return {
			code: LayoutFailureReasonCode.UnsupportedLaneLayout,
			message: m.diagnostics_unsupported_lane_layout(),
		};
	}
	if (cause instanceof UnknownLayoutPresentationError) {
		return {
			code: LayoutFailureReasonCode.UnknownLaneLayout,
			message: m.diagnostics_unknown_lane_layout(),
		};
	}
	if (cause instanceof UnresolvedFoldedGroupLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnknownFoldedGroupLayout,
			message: m.diagnostics_unknown_folded_group_layout(),
		};
	}
	if (cause instanceof Error) {
		const missing = [
			{
				prefix: 'Missing node measurement: ',
				ids: document.nodes.map(({ id }) => id),
				code: LayoutFailureReasonCode.MissingNodeMeasurement,
				message: m.diagnostics_missing_node_measurement,
			},
			{
				prefix: 'Missing group measurement: ',
				ids: document.groups.map(({ id }) => id),
				code: LayoutFailureReasonCode.MissingGroupMeasurement,
				message: m.diagnostics_missing_group_measurement,
			},
			{
				prefix: 'Missing junction measurement: ',
				ids: document.junctions.map(({ id }) => id),
				code: LayoutFailureReasonCode.MissingJunctionMeasurement,
				message: m.diagnostics_missing_junction_measurement,
			},
		];
		for (const { prefix, ids, code, message } of missing) {
			if (!cause.message.startsWith(prefix)) continue;
			const elementId = cause.message.slice(prefix.length);
			if (!ids.includes(elementId)) continue;
			return {
				code,
				elementId,
				message: message({ elementId }),
			};
		}
		if (cause.message === 'Unresolved channel routing constraint cycle') {
			return {
				code: LayoutFailureReasonCode.RoutingConstraintCycle,
				message: m.diagnostics_routing_constraint_cycle(),
			};
		}
	}
	return {
		code: LayoutFailureReasonCode.CalculationFailed,
		message: m.diagnostics_layout_calculation_failed(),
	};
}

export function layoutDiagnostic(document: LogicDocument, cause?: unknown): LayoutDiagnostic {
	const ids = (items: readonly { readonly id: string }[]) =>
		items.map(({ id }) => id).sort(compareCanonicalStrings);
	return {
		code: LayoutDiagnosticCode.LayoutFailed,
		reason: layoutFailureReason(document, cause),
		documentId: document.id,
		title: document.title,
		direction: document.layout.direction,
		nodeIds: ids(document.nodes),
		groupIds: ids(document.groups),
		junctionIds: ids(document.junctions),
		relationIds: ids(document.relations),
	};
}

export class LayoutProjectionError extends Error {
	readonly diagnostic: LayoutDiagnostic;
	readonly regions?: readonly RegionPreview[];

	constructor(document: LogicDocument, cause: unknown) {
		let originalCause = cause;
		if (cause instanceof PartialRegionLayoutError) originalCause = cause.originalCause;
		let message = String(originalCause);
		if (originalCause instanceof Error) message = originalCause.message;
		super(message, { cause: originalCause });
		this.name = 'LayoutProjectionError';
		this.diagnostic = layoutDiagnostic(document, originalCause);
		if (cause instanceof PartialRegionLayoutError) this.regions = cause.regions;
	}
}

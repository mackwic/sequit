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
			message: `Aucun passage valide pour la relation « ${cause.relationId} ».`,
		};
	if (cause instanceof UnsupportedGridCellLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnsupportedRegionLayout,
			message: 'Cette configuration de grille n’est pas encore prise en charge.',
		};
	}
	if (cause instanceof UnknownGridCellLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnknownRegionLayout,
			message: 'Le moteur n’a pas trouvé de géométrie validée pour cette grille.',
		};
	}
	if (cause instanceof UnsupportedRegionLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnsupportedRegionLayout,
			message: 'Cette configuration de régions n’est pas encore prise en charge.',
		};
	}
	if (cause instanceof UnknownRegionLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnknownRegionLayout,
			message: 'Le moteur n’a pas trouvé de géométrie validée pour ces régions.',
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
			message: 'Cette configuration de lanes n’est pas encore prise en charge.',
		};
	}
	if (cause instanceof UnknownLayoutPresentationError) {
		return {
			code: LayoutFailureReasonCode.UnknownLaneLayout,
			message: 'Le moteur n’a pas trouvé de géométrie validée pour ces lanes.',
		};
	}
	if (cause instanceof UnresolvedFoldedGroupLayoutError) {
		return {
			code: LayoutFailureReasonCode.UnknownFoldedGroupLayout,
			message: 'Le moteur n’a pas trouvé de géométrie validée pour ce groupe replié.',
		};
	}
	if (cause instanceof Error) {
		const missing = [
			{
				prefix: 'Missing node measurement: ',
				ids: document.nodes.map(({ id }) => id),
				code: LayoutFailureReasonCode.MissingNodeMeasurement,
				kind: 'le nœud',
			},
			{
				prefix: 'Missing group measurement: ',
				ids: document.groups.map(({ id }) => id),
				code: LayoutFailureReasonCode.MissingGroupMeasurement,
				kind: 'le groupe',
			},
			{
				prefix: 'Missing junction measurement: ',
				ids: document.junctions.map(({ id }) => id),
				code: LayoutFailureReasonCode.MissingJunctionMeasurement,
				kind: 'la jonction',
			},
		];
		for (const { prefix, ids, code, kind } of missing) {
			if (!cause.message.startsWith(prefix)) continue;
			const elementId = cause.message.slice(prefix.length);
			if (!ids.includes(elementId)) continue;
			return {
				code,
				elementId,
				message: `Mesure manquante pour ${kind} « ${elementId} ».`,
			};
		}
		if (cause.message === 'Unresolved channel routing constraint cycle') {
			return {
				code: LayoutFailureReasonCode.RoutingConstraintCycle,
				message: 'Les contraintes de routage forment un cycle sans solution.',
			};
		}
	}
	return {
		code: LayoutFailureReasonCode.CalculationFailed,
		message: 'Le moteur de mise en page n’a pas produit de géométrie valide.',
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

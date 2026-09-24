import type { TopologicalRanks } from '../graph/topological-ranks';
import type { Bounds, LayoutResult, Point } from './layout-types';
import type { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';
import type {
	RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from './region-incident-contract';
import type { RegionPortalSide } from './region-portal-side';

export { RegionPortalSide } from './region-portal-side';

/** A child layout stays in local coordinates until its parent places it. */
export interface RegionChildPlacement {
	readonly id: string;
	readonly parentId: string;
	readonly bounds: Bounds;
	readonly translation: Point;
	readonly localLayout: LayoutResult;
	readonly localRanks: TopologicalRanks;
}

type RegionPortalSideValue = `${RegionPortalSide}`;

interface RegionPortalBase<Side extends RegionPortalSideValue = RegionPortalSideValue> {
	readonly relationId: string;
	readonly endpointId: string;
	readonly side: Side;
	readonly point: Point;
}

/** Normalized portal published by a child to its parent. */
export interface RegionPortal<
	Side extends RegionPortalSideValue = RegionPortalSideValue,
> extends RegionPortalBase<Side> {
	readonly regionId: string;
	readonly localPoint: Point;
}

export interface RegionOwnedRoute {
	readonly relationId: string;
	readonly regionId: string;
	readonly points: readonly Point[];
}

export enum RegionCompositionStatus {
	Selected = 'selected',
	Unknown = 'unknown',
	Unsupported = 'unsupported',
}

export interface RegionCompositionSelected<Portal extends RegionPortalBase = RegionPortalBase> {
	readonly status: RegionCompositionStatus.Selected;
	readonly rootId: string;
	readonly layout: LayoutResult;
	readonly portals: readonly Portal[];
}

interface RegionCompositionUnknown {
	readonly status: RegionCompositionStatus.Unknown;
	readonly reason: string;
	readonly code?: RegionGeometryDiagnosticCode | RegionIncidentUnknownCode;
	readonly witness?: RegionIncidentSearchWitness;
	readonly regionId?: string;
	readonly relationId?: string;
}

interface RegionCompositionUnsupported {
	readonly status: RegionCompositionStatus.Unsupported;
	readonly reason: string;
}

export type RegionCompositionAttempt<Selected extends RegionCompositionSelected> =
	Selected | RegionCompositionUnknown | RegionCompositionUnsupported;

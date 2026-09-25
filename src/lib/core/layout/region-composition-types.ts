import type {
	GridLayoutPresentation,
	LayoutConfiguration,
	LayoutPolicy,
	RegionLanePresentation,
} from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { Bounds, LayoutResult, Point } from './layout-types';
import type { RegionPortalSide } from './region-portal-side';
import type { RegionCompositionFailureEvidence } from './region-search-evidence';

export { RegionPortalSide } from './region-portal-side';

interface RegionDefinitionFields {
	readonly id: string;
	readonly parentId?: string;
	readonly layoutOrder: string;
	readonly layout?: LayoutConfiguration;
	readonly lanePresentation?: RegionLanePresentation;
	readonly grid?: GridLayoutPresentation;
}

/** A normalized region always has a policy before a leaf is dispatched. */
export interface RegionDefinition extends RegionDefinitionFields {
	readonly policy: LayoutPolicy;
}

/** Earlier derived inputs may omit the policy; normalization materializes it once. */
export interface RegionInputDefinition extends RegionDefinitionFields {
	readonly policy?: LayoutPolicy;
}

export interface RegionInput {
	readonly regions: readonly RegionInputDefinition[];
	readonly regionByEndpointId: ReadonlyMap<string, string>;
}

/** A child layout stays in local coordinates until its parent places it. */
export interface RegionChildPlacement {
	readonly id: string;
	readonly parentId: string;
	readonly bounds: Bounds;
	readonly translation: Point;
	readonly localLayout: LayoutResult;
	readonly localRanks: TopologicalRanks;
}

interface RegionPortalBase<Side extends RegionPortalSide = RegionPortalSide> {
	readonly relationId: string;
	readonly endpointId: string;
	readonly side: Side;
	readonly point: Point;
}

/** Normalized portal published by a child to its parent. */
export interface RegionPortal<
	Side extends RegionPortalSide = RegionPortalSide,
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

export type RegionCompositionUnknown = {
	readonly status: RegionCompositionStatus.Unknown;
	readonly reason: string;
	readonly regionId?: string;
	readonly relationId?: string;
} & RegionCompositionFailureEvidence;

interface RegionCompositionUnsupported {
	readonly status: RegionCompositionStatus.Unsupported;
	readonly reason: string;
}

export type RegionCompositionAttempt<Selected extends RegionCompositionSelected> =
	Selected | RegionCompositionUnknown | RegionCompositionUnsupported;

export interface RegionLayoutSelected extends RegionCompositionSelected<RegionPortal> {
	readonly regions: readonly RegionChildPlacement[];
	readonly ownedRoutes: readonly RegionOwnedRoute[];
}

export type RegionLayoutAttempt = RegionCompositionAttempt<RegionLayoutSelected>;

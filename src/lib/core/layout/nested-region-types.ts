import type {
	GridLayoutPresentation,
	LayoutConfiguration,
	LayoutPolicy,
	RegionLanePresentation,
} from '../document/logic-document';
import type {
	RegionChildPlacement,
	RegionCompositionAttempt,
	RegionCompositionSelected,
	RegionOwnedRoute,
	RegionPortal,
} from './region-composition-types';

export { RegionCompositionStatus as NestedRegionLayoutStatus } from './region-composition-types';

/** A derived layout region, supplied separately from the current document schema. */
export interface NestedRegionDefinition {
	readonly id: string;
	readonly parentId?: string;
	readonly layoutOrder: string;
	readonly policy?: LayoutPolicy;
	/** A child may choose its own flow direction; no rank is shared with its siblings. */
	readonly layout?: LayoutConfiguration;
	/** A leaf may resolve its own two lanes without sharing lane identities with siblings. */
	readonly lanePresentation?: RegionLanePresentation;
	/** An inner region may arrange its direct children as a grid. */
	readonly grid?: GridLayoutPresentation;
}

export interface NestedRegionInput {
	readonly regions: readonly NestedRegionDefinition[];
	readonly regionByEndpointId: ReadonlyMap<string, string>;
}

/** Translation is from the child's independent canvas to root coordinates. */
export type NestedRegionPlacement = RegionChildPlacement;

export type NestedRegionPortal = RegionPortal<NestedPortalSide>;

export enum NestedPortalSide {
	Top = 'top',
	Bottom = 'bottom',
	Left = 'left',
	Right = 'right',
}

export type NestedOwnedRoute = RegionOwnedRoute;

export interface NestedRegionSelected extends RegionCompositionSelected<NestedRegionPortal> {
	readonly regions: readonly NestedRegionPlacement[];
	readonly ownedRoutes: readonly NestedOwnedRoute[];
}

export type NestedRegionLayoutAttempt = RegionCompositionAttempt<NestedRegionSelected>;

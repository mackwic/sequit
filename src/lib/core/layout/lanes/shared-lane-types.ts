import type { Bounds, LayoutElement, LayoutRelation } from '../layout-types';

/** Where a box sits across the lanes, before its rows are placed. */
export interface CrossExtent {
	readonly cross: number;
	readonly crossSize: number;
}

/** A box in lane coordinates: `cross` across the lanes, `longitudinal` along the rows. */
export interface LogicalBox extends CrossExtent {
	readonly longitudinal: number;
	readonly longSize: number;
}

export interface SharedLaneBounds {
	readonly id: string;
	readonly bounds: Bounds;
}

export interface SharedLaneGeometry {
	readonly lanes: readonly SharedLaneBounds[];
	readonly elements: readonly LayoutElement[];
	readonly relations: readonly LayoutRelation[];
	readonly width: number;
	readonly height: number;
}

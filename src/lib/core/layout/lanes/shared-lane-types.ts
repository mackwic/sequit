import type { Bounds, LayoutElement, LayoutRelation } from '../layout-types';

/** A box in lane coordinates: `cross` across the lanes, `longitudinal` along the rows. */
export interface LogicalBox {
	readonly cross: number;
	readonly longitudinal: number;
	readonly crossSize: number;
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

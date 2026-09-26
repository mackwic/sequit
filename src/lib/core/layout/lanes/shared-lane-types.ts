import type { Bounds, LayoutElement, LayoutRelation } from '../layout-types';

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

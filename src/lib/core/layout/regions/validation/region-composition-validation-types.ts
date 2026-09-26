import type { Bounds, LayoutResult, Point } from '../../layout-types';
import type { RegionOwnedRoute, RegionPortal } from '../model/region-composition-types';

/** The geometry shared by row and grid dispositions, in root coordinates. */
export interface RegionGeometryPlacement {
	readonly id: string;
	readonly parentId: string;
	readonly bounds: Bounds;
	/** Inner regions need only a frame; leaves publish the layout they placed. */
	readonly translation?: Point;
	readonly localLayout?: LayoutResult;
}

export interface RegionCompositionGeometryCandidate {
	readonly rootId: string;
	readonly layout: LayoutResult;
	readonly regions: readonly RegionGeometryPlacement[];
	readonly portals: readonly RegionPortal[];
	readonly ownedRoutes: readonly RegionOwnedRoute[];
}

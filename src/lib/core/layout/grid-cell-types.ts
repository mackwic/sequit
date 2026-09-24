import type { LayoutConfiguration } from '../document/logic-document';
import type {
	RegionChildPlacement,
	RegionCompositionAttempt,
	RegionCompositionSelected,
	RegionPortal,
	RegionPortalSide,
} from './region-composition-types';

export { RegionCompositionStatus as GridCellLayoutStatus } from './region-composition-types';

/** Experimental, derived composition input; it is not a persisted document schema. */
export interface GridCellDefinition {
	readonly id: string;
	readonly parentId: string;
	readonly row: number;
	readonly column: number;
	readonly layout?: LayoutConfiguration;
}

export interface GridCellInput {
	readonly rootId: string;
	readonly cells: readonly GridCellDefinition[];
	readonly cellByEndpointId: ReadonlyMap<string, string>;
	readonly minimumColumnWidths: readonly number[];
	readonly minimumRowHeights: readonly number[];
}

export interface GridCellPlacement extends RegionChildPlacement {
	readonly row: number;
	readonly column: number;
}

export interface GridCellPortal extends RegionPortal<
	RegionPortalSide.Left | RegionPortalSide.Right
> {
	readonly cellId: string;
}

export interface GridCellSelected extends RegionCompositionSelected<GridCellPortal> {
	readonly cells: readonly GridCellPlacement[];
	readonly columnWidths: readonly number[];
	readonly rowHeights: readonly number[];
}

export type GridCellLayoutAttempt = RegionCompositionAttempt<GridCellSelected>;

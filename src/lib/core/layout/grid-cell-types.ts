import type { LayoutConfiguration } from '../document/logic-document';
import type {
	RegionChildPlacement,
	RegionCompositionAttempt,
	RegionCompositionSelected,
	RegionPortal,
} from './region-composition-types';

export { RegionCompositionStatus as GridCellLayoutStatus } from './region-composition-types';

/** Experimental, derived composition input; it is not a persisted document schema. */
export interface GridCellDefinition {
	readonly id: string;
	readonly parentId: string;
	readonly row: 0 | 1;
	readonly column: 0 | 1;
	readonly layout?: LayoutConfiguration;
}

export interface GridCellInput {
	readonly rootId: string;
	readonly cells: readonly GridCellDefinition[];
	readonly cellByEndpointId: ReadonlyMap<string, string>;
	readonly minimumColumnWidths: readonly [number, number];
	readonly minimumRowHeights: readonly [number, number];
}

export interface GridCellPlacement extends RegionChildPlacement {
	readonly row: 0 | 1;
	readonly column: 0 | 1;
}

export interface GridCellPortal extends RegionPortal {
	readonly cellId: string;
	readonly side: GridCellSide;
}

export enum GridCellSide {
	Left = 'left',
	Right = 'right',
}

export interface GridCellSelected extends RegionCompositionSelected<GridCellPortal> {
	readonly cells: readonly GridCellPlacement[];
	readonly columnWidths: readonly [number, number];
	readonly rowHeights: readonly [number, number];
}

export type GridCellLayoutAttempt = RegionCompositionAttempt<GridCellSelected>;

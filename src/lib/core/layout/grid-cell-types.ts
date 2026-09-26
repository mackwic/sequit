import type { LayoutConfiguration } from '../document/logic-document';
import type { GridCrossingAllocation } from './grid-cell-crossing-allocation';
import type { GridCrossingAllocationSelectedWitness } from './grid-cell-crossing-phases';
import type {
	RegionChildPlacement,
	RegionCompositionAttempt,
	RegionCompositionSelected,
	RegionCompositionStatus,
	RegionPortal,
	RegionPortalSide,
} from './region-composition-types';
import type {
	RegionCompositionFailureEvidence,
	RegionSearchProvenance,
} from './region-search-evidence';

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

/** The grid solver's selected candidate carries its actual allocation and bounded-search evidence. */
export interface GridCellAllocationSelected extends GridCellSelected {
	readonly allocation: GridCrossingAllocation;
	readonly witness: GridCrossingAllocationSelectedWitness;
}

type GridCellGridFailureEvidence = Extract<
	RegionCompositionFailureEvidence,
	{ readonly provenance: RegionSearchProvenance.Grid }
>;
type GridCellDiagnosticOnlyFailureEvidence = Extract<
	RegionCompositionFailureEvidence,
	{ readonly provenance?: undefined }
>;

export type GridCellLayoutAttempt = RegionCompositionAttempt<
	GridCellAllocationSelected,
	GridCellGridFailureEvidence | GridCellDiagnosticOnlyFailureEvidence
>;

export type GridCellRouteAttempt = Extract<
	RegionCompositionAttempt<GridCellAllocationSelected, GridCellGridFailureEvidence>,
	{
		readonly status: RegionCompositionStatus.Selected | RegionCompositionStatus.Unknown;
	}
>;

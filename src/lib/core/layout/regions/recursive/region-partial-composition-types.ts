import type { LogicDocument } from '../../../document/logic-document';
import type { TopologicalRanks } from '../../../graph/topological-ranks';
import type { LayoutResult } from '../../layout-types';
import type { RegionCompositionDiagnostic } from '../model/region-composition-limits';
import type { RegionCompositionStatus } from '../model/region-composition-types';
import type { RegionCompositionFailureEvidence } from '../model/region-search-evidence';

export const REGION_SUBTREE_CALCULATION_FAILED = 'calculation-failed' as const;

export enum RegionSubtreeScope {
	Leaf = 'leaf',
	ClosedSubtree = 'closed-subtree',
}

interface RegionSubtreeSelectedBase {
	readonly status: RegionCompositionStatus.Selected;
	readonly regionId: string;
	readonly document: LogicDocument;
	readonly layout: LayoutResult;
}

interface RegionLeafSubtreeSelected extends RegionSubtreeSelectedBase {
	readonly scope: RegionSubtreeScope.Leaf;
	readonly ranks: TopologicalRanks;
}

interface RegionClosedSubtreeSelected extends RegionSubtreeSelectedBase {
	readonly scope: RegionSubtreeScope.ClosedSubtree;
}

interface RegionSubtreeFailureBase {
	readonly regionId: string;
	readonly scope: RegionSubtreeScope;
	readonly reason: string;
	readonly failureRegionId?: string | undefined;
	readonly relationId?: string | undefined;
	readonly endpointIds: readonly string[];
	readonly relationIds: readonly string[];
	readonly diagnostic?: RegionCompositionDiagnostic | undefined;
}

export type RegionSubtreeFailure =
	| (RegionSubtreeFailureBase & {
			readonly status: RegionCompositionStatus.Unknown;
	  } & RegionCompositionFailureEvidence)
	| (RegionSubtreeFailureBase & {
			readonly status:
				RegionCompositionStatus.Unsupported | typeof REGION_SUBTREE_CALCULATION_FAILED;
			readonly provenance?: undefined;
			readonly code?: undefined;
			readonly witness?: undefined;
	  });

export type RegionSubtreeAttempt =
	RegionLeafSubtreeSelected | RegionClosedSubtreeSelected | RegionSubtreeFailure;

type FailureProvenance = RegionCompositionFailureEvidence & {
	readonly failureRegionId?: string | undefined;
	readonly relationId?: string | undefined;
};

interface FailureInputBase {
	readonly regionId: string;
	readonly scope: RegionSubtreeScope;
	readonly document: LogicDocument;
	readonly reason: string;
}

interface UnknownFailureInput extends FailureInputBase {
	readonly status: RegionCompositionStatus.Unknown;
	readonly provenance: FailureProvenance;
}

interface UnsupportedFailureInput extends FailureInputBase {
	readonly status: RegionCompositionStatus.Unsupported | typeof REGION_SUBTREE_CALCULATION_FAILED;
	readonly diagnostic?: RegionCompositionDiagnostic | undefined;
}

export type RegionSubtreeFailureInput = UnknownFailureInput | UnsupportedFailureInput;

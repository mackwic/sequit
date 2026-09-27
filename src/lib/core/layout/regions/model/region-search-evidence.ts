import type { RegionGeometryDiagnosticCode } from '../../geometry/region-geometry-diagnostic';
import type { GridCrossingAllocationWitness } from '../../search/grid-cell-crossing-witness';
import type {
	RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from './region-incident-contract';

export enum RegionSearchProvenance {
	Incident = 'incident',
	Grid = 'grid',
}

interface IncidentSearchEvidence {
	readonly provenance: RegionSearchProvenance.Incident;
	readonly code: RegionIncidentUnknownCode;
	readonly witness: RegionIncidentSearchWitness;
}

interface GridSearchEvidence {
	readonly provenance: RegionSearchProvenance.Grid;
	readonly code: RegionGeometryDiagnosticCode;
	readonly witness: GridCrossingAllocationWitness;
}

export enum RegionCompositionSearchCode {
	SearchBudgetExceeded = 'composition-search-budget-exceeded',
}

interface DiagnosticOnlyFailureEvidence {
	readonly provenance?: undefined;
	readonly code?:
		RegionGeometryDiagnosticCode | RegionIncidentUnknownCode | RegionCompositionSearchCode;
	readonly witness?: undefined;
}

/** A bounded failure records which solver owns the witness and the code that ended its search. */
export type RegionSearchEvidence = IncidentSearchEvidence | GridSearchEvidence;

/** Unknowns without bounded-search evidence still carry any available diagnostic code. */
export type RegionCompositionFailureEvidence = RegionSearchEvidence | DiagnosticOnlyFailureEvidence;

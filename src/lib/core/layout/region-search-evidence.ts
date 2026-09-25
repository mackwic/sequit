import type { GridCrossingAllocationWitness } from './grid-cell-crossing-witness';
import type { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';
import type {
	RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from './region-incident-contract';

export enum RegionSearchProvenance {
	Incident = 'incident',
	Grid = 'grid',
}

export interface IncidentSearchEvidence {
	readonly provenance: RegionSearchProvenance.Incident;
	readonly code: RegionIncidentUnknownCode;
	readonly witness: RegionIncidentSearchWitness;
}

export interface GridSearchEvidence {
	readonly provenance: RegionSearchProvenance.Grid;
	readonly code: RegionGeometryDiagnosticCode;
	readonly witness: GridCrossingAllocationWitness;
}

export interface DiagnosticOnlyFailureEvidence {
	readonly provenance?: undefined;
	readonly code?: RegionGeometryDiagnosticCode | RegionIncidentUnknownCode;
	readonly witness?: undefined;
}

/** A bounded failure records which solver owns the witness and the code that ended its search. */
export type RegionSearchEvidence = IncidentSearchEvidence | GridSearchEvidence;

/** Unknowns without bounded-search evidence still carry any available diagnostic code. */
export type RegionCompositionFailureEvidence = RegionSearchEvidence | DiagnosticOnlyFailureEvidence;

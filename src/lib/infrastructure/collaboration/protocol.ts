export const MAX_PROPOSAL_ID_BYTES = 128;

export interface ProtocolDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
}

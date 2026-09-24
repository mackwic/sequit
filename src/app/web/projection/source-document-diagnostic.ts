import type { InvalidSourceDocumentState } from '../../../lib/infrastructure/collaboration/source-document-state';

/** Signals that the current physical Y.Doc cannot be projected onto the canvas. */
export class SourceDocumentProjectionError extends Error {
	readonly state: InvalidSourceDocumentState;

	constructor(state: InvalidSourceDocumentState) {
		super(state.diagnostics.map(({ message }) => message).join('; '));
		this.name = 'SourceDocumentProjectionError';
		this.state = state;
	}
}

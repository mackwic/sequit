export enum YjsLiveDocumentDiagnosticCode {
	Invalid = 'invalid-yjs-live-document',
	UnsupportedFormat = 'unsupported-yjs-live-document-format',
}

interface YjsLiveDocumentDiagnostic {
	readonly code: YjsLiveDocumentDiagnosticCode;
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
	readonly expectedOrder?: readonly string[];
	readonly materializedOrder?: readonly string[];
	readonly expectedScore?: number;
	readonly materializedScore?: number;
}

interface YjsLiveDocumentSuccess<T> {
	readonly ok: true;
	readonly value: T;
}

export interface YjsLiveDocumentFailure {
	readonly ok: false;
	readonly diagnostics: readonly YjsLiveDocumentDiagnostic[];
}

export type YjsLiveDocumentResult<T> = YjsLiveDocumentSuccess<T> | YjsLiveDocumentFailure;

export interface ReadContext {
	readonly diagnostics: YjsLiveDocumentDiagnostic[];
}

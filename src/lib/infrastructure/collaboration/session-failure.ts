export enum SessionFailureCode {
	InvalidMessage = 'invalid-message',
	InvalidDocument = 'invalid-document',
	StorageUnavailable = 'storage-unavailable',
	CommandGap = 'command-gap',
}

export class RetryableSessionFailure extends Error {
	constructor(
		readonly code: SessionFailureCode,
		message: string,
	) {
		super(message);
	}
}

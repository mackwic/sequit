export enum SessionFailureCode {
	InvalidMessage = 'invalid-message',
	InvalidDocument = 'invalid-document',
	StorageUnavailable = 'storage-unavailable',
	CommandGap = 'command-gap',
	CorruptCommandReceipt = 'corrupt-command-receipt',
	RepeatedCommandRefusal = 'repeated-command-refusal',
}

export class BusinessCommandRefusal extends Error {}

export class StaleSharedCommandError extends BusinessCommandRefusal {}

export class RetryableSessionFailure extends Error {
	constructor(
		readonly code: SessionFailureCode,
		message: string,
	) {
		super(message);
	}
}

export enum ConflictCode {
	CommandConflict = 'command-conflict',
	InvalidCommand = 'invalid-command',
	TextTargetGone = 'text-target-gone',
}

export class TerminalSessionFailure extends Error {
	constructor(
		readonly code: SessionFailureCode,
		message: string,
	) {
		super(message);
	}
}

export enum SessionFailureCode {
	InvalidMessage = 'invalid-message',
	InvalidDocument = 'invalid-document',
	StorageUnavailable = 'storage-unavailable',
	CommandGap = 'command-gap',
	CorruptCommandReceipt = 'corrupt-command-receipt',
}

export class RetryableSessionFailure extends Error {
	constructor(
		readonly code: SessionFailureCode,
		message: string,
	) {
		super(message);
	}
}

export enum ConflictCode {
	TextTargetGone = 'text-target-gone',
	CommandConflict = 'command-conflict',
	InvalidCommand = 'invalid-command',
}

export class SessionConflict extends Error {
	constructor(
		readonly code: ConflictCode,
		message: string,
		readonly targetId?: string,
	) {
		super(message);
	}
}

export class TerminalSessionFailure extends Error {
	constructor(
		readonly code: SessionFailureCode,
		message: string,
	) {
		super(message);
	}
}

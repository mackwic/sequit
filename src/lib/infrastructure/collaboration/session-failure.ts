import type {
	CommandRefusal,
	SessionFailureCode,
	SessionReason,
	SessionRejection,
} from './session-reasons';

export class BusinessCommandRefusal extends Error {
	constructor(readonly reason: CommandRefusal) {
		super(reason.code);
	}
}

export class StaleSharedCommandError extends BusinessCommandRefusal {}

export class RetryableSessionFailure extends Error {
	constructor(
		readonly code: SessionFailureCode,
		readonly reason: SessionRejection,
	) {
		super(reason.code);
	}
}

export class TerminalSessionFailure extends Error {
	constructor(
		readonly code: SessionFailureCode,
		readonly reason: SessionRejection,
	) {
		super(reason.code);
	}
}

export class SessionNoticeError extends Error {
	constructor(readonly reason: SessionReason) {
		super(reason.code);
	}
}

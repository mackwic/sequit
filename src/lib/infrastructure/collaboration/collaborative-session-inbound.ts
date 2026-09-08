import {
	type AcceptedMessage,
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	type RejectedMessage,
	type SyncResponseMessage,
} from './protocol';

export interface CollaborativeSessionMessageHandlers {
	readonly malformed: () => void;
	readonly syncResponse: (message: SyncResponseMessage) => void;
	readonly accepted: (message: AcceptedMessage) => void;
	readonly rejected: (message: RejectedMessage) => void;
	readonly protocolError: () => void;
}

/* istanbul ignore next -- exhaustive switch guards are unreachable after type checking */
function assertNever(value: never): never {
	throw new TypeError(`Unexpected collaboration message: ${String(value)}`);
}

function dispatchMessage(
	message: CollabMessage,
	handlers: CollaborativeSessionMessageHandlers,
): void {
	switch (message.type) {
		case CollabMessageKind.SyncResponse:
			handlers.syncResponse(message);
			return;
		case CollabMessageKind.Accepted:
			handlers.accepted(message);
			return;
		case CollabMessageKind.Rejected:
			handlers.rejected(message);
			return;
		case CollabMessageKind.ProtocolError:
			handlers.protocolError();
			return;
		case CollabMessageKind.SyncRequest:
		case CollabMessageKind.Proposal:
			return;
		/* istanbul ignore next -- exhaustive switch guard */
		default:
			return assertNever(message);
	}
}

export function dispatchSessionFrame(
	frame: Uint8Array,
	handlers: CollaborativeSessionMessageHandlers,
): void {
	const decoded = decodeCollabMessage(frame);
	if (!decoded.ok) {
		handlers.malformed();
		return;
	}
	dispatchMessage(decoded.value, handlers);
}

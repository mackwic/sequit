import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const COLLAB_PROTOCOL_VERSION = 1 as const;

export enum CollabMessageKind {
	SyncRequest = 'sync-request',
	SyncResponse = 'sync-response',
	Proposal = 'proposal',
	Accepted = 'accepted',
	Rejected = 'rejected',
	ProtocolError = 'protocol-error',
}

export enum ProposalIntent {
	Initialize = 'initialize',
	Change = 'change',
}

export enum ProtocolDiagnosticCode {
	UnsupportedProtocolVersion = 'unsupported-protocol-version',
	UnknownMessageKind = 'unknown-message-kind',
	MalformedProtocolFrame = 'malformed-protocol-frame',
}

export interface ProtocolDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
}

export interface SyncRequestMessage {
	readonly type: CollabMessageKind.SyncRequest;
	readonly lastCommit: number;
	readonly stateVector: Uint8Array;
}

export interface SyncResponseMessage {
	readonly type: CollabMessageKind.SyncResponse;
	readonly commit: number;
	readonly update: Uint8Array;
	readonly stateVector: Uint8Array;
}

export interface ProposalMessage {
	readonly type: CollabMessageKind.Proposal;
	readonly proposalId: string;
	readonly intent: ProposalIntent;
	readonly update: Uint8Array;
}

export interface AcceptedMessage {
	readonly type: CollabMessageKind.Accepted;
	readonly proposalId?: string;
	readonly commit: number;
	readonly update: Uint8Array;
	readonly stateVector: Uint8Array;
}

export interface RejectedMessage {
	readonly type: CollabMessageKind.Rejected;
	readonly proposalId: string;
	readonly diagnostics: readonly ProtocolDiagnostic[];
}

export interface ProtocolErrorMessage {
	readonly type: CollabMessageKind.ProtocolError;
	readonly message: string;
}

export type CollabMessage =
	| SyncRequestMessage
	| SyncResponseMessage
	| ProposalMessage
	| AcceptedMessage
	| RejectedMessage
	| ProtocolErrorMessage;

interface DecodeSuccess {
	readonly ok: true;
	readonly value: CollabMessage;
}

interface DecodeFailure {
	readonly ok: false;
	readonly diagnostics: readonly ProtocolDiagnostic[];
}

export type DecodeResult = DecodeSuccess | DecodeFailure;

const MESSAGE_KINDS: readonly CollabMessageKind[] = [
	CollabMessageKind.SyncRequest,
	CollabMessageKind.SyncResponse,
	CollabMessageKind.Proposal,
	CollabMessageKind.Accepted,
	CollabMessageKind.Rejected,
	CollabMessageKind.ProtocolError,
];

/* istanbul ignore next -- exhaustive switch guards are unreachable after type checking */
function assertNever(value: never): never {
	throw new TypeError(`Unexpected collaboration message: ${String(value)}`);
}

export function encodeCollabMessage(message: CollabMessage): Uint8Array {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, COLLAB_PROTOCOL_VERSION);
	encoding.writeVarUint(encoder, MESSAGE_KINDS.indexOf(message.type));
	switch (message.type) {
		case CollabMessageKind.SyncRequest:
			encoding.writeVarUint(encoder, message.lastCommit);
			encoding.writeVarUint8Array(encoder, message.stateVector);
			break;
		case CollabMessageKind.SyncResponse:
			encoding.writeVarUint(encoder, message.commit);
			encoding.writeVarUint8Array(encoder, message.update);
			encoding.writeVarUint8Array(encoder, message.stateVector);
			break;
		case CollabMessageKind.Proposal:
			encoding.writeVarString(encoder, message.proposalId);
			if (message.intent === ProposalIntent.Initialize) encoding.writeUint8(encoder, 0);
			else encoding.writeUint8(encoder, 1);
			encoding.writeVarUint8Array(encoder, message.update);
			break;
		case CollabMessageKind.Accepted:
			encoding.writeVarString(encoder, message.proposalId ?? '');
			encoding.writeVarUint(encoder, message.commit);
			encoding.writeVarUint8Array(encoder, message.update);
			encoding.writeVarUint8Array(encoder, message.stateVector);
			break;
		case CollabMessageKind.Rejected:
			encoding.writeVarString(encoder, message.proposalId);
			encoding.writeVarString(encoder, JSON.stringify(message.diagnostics));
			break;
		case CollabMessageKind.ProtocolError:
			encoding.writeVarString(encoder, message.message);
			break;
		/* istanbul ignore next -- exhaustive switch guard */
		default:
			return assertNever(message);
	}
	return encoding.toUint8Array(encoder);
}

function malformedDiagnostic(message: string): DecodeFailure {
	return {
		ok: false,
		diagnostics: [
			{
				code: ProtocolDiagnosticCode.MalformedProtocolFrame,
				message,
				path: ['protocol'],
			},
		],
	};
}

function isProtocolDiagnostic(value: unknown): value is ProtocolDiagnostic {
	if (typeof value !== 'object') return false;
	if (value === null) return false;
	if (Array.isArray(value)) return false;
	if (!('code' in value)) return false;
	if (!('message' in value)) return false;
	if (!('path' in value)) return false;
	if (typeof value.code !== 'string') return false;
	if (typeof value.message !== 'string') return false;
	if (!Array.isArray(value.path)) return false;
	return value.path.every((segment) => typeof segment === 'string');
}

function readDiagnostics(decoder: decoding.Decoder): readonly ProtocolDiagnostic[] {
	const parsed = JSON.parse(decoding.readVarString(decoder)) as unknown;
	if (!Array.isArray(parsed) || !parsed.every(isProtocolDiagnostic)) {
		throw new TypeError('Rejected diagnostics must be an array of protocol diagnostics');
	}
	return parsed;
}

function readProposalIntent(decoder: decoding.Decoder): ProposalIntent {
	const intent = decoding.readUint8(decoder);
	if (intent === 0) return ProposalIntent.Initialize;
	if (intent === 1) return ProposalIntent.Change;
	throw new TypeError('Unknown proposal intent');
}

function decodeMessage(decoder: decoding.Decoder, kind: CollabMessageKind): CollabMessage {
	switch (kind) {
		case CollabMessageKind.SyncRequest:
			return {
				type: kind,
				lastCommit: decoding.readVarUint(decoder),
				stateVector: decoding.readVarUint8Array(decoder),
			};
		case CollabMessageKind.SyncResponse:
			return {
				type: kind,
				commit: decoding.readVarUint(decoder),
				update: decoding.readVarUint8Array(decoder),
				stateVector: decoding.readVarUint8Array(decoder),
			};
		case CollabMessageKind.Proposal:
			return {
				type: kind,
				proposalId: decoding.readVarString(decoder),
				intent: readProposalIntent(decoder),
				update: decoding.readVarUint8Array(decoder),
			};
		case CollabMessageKind.Accepted: {
			const proposalId = decoding.readVarString(decoder);
			const message: AcceptedMessage = {
				type: kind,
				commit: decoding.readVarUint(decoder),
				update: decoding.readVarUint8Array(decoder),
				stateVector: decoding.readVarUint8Array(decoder),
			};
			if (proposalId === '') return message;
			return { ...message, proposalId };
		}
		case CollabMessageKind.Rejected:
			return {
				type: kind,
				proposalId: decoding.readVarString(decoder),
				diagnostics: readDiagnostics(decoder),
			};
		case CollabMessageKind.ProtocolError:
			return { type: kind, message: decoding.readVarString(decoder) };
		/* istanbul ignore next -- exhaustive switch guard */
		default:
			return assertNever(kind);
	}
}

export function decodeCollabMessage(frame: Uint8Array): DecodeResult {
	try {
		const decoder = decoding.createDecoder(frame);
		const version = decoding.readVarUint(decoder);
		if (version !== COLLAB_PROTOCOL_VERSION) {
			return {
				ok: false,
				diagnostics: [
					{
						code: ProtocolDiagnosticCode.UnsupportedProtocolVersion,
						message: `Unsupported collaboration protocol version: ${version}`,
						path: ['protocol', 'version'],
					},
				],
			};
		}

		const kindIndex = decoding.readVarUint(decoder);
		const kind = MESSAGE_KINDS[kindIndex];
		if (kind === undefined) {
			return {
				ok: false,
				diagnostics: [
					{
						code: ProtocolDiagnosticCode.UnknownMessageKind,
						message: `Unknown collaboration message kind: ${kindIndex}`,
						path: ['protocol', 'kind'],
					},
				],
			};
		}

		const message = decodeMessage(decoder, kind);
		if (decoding.hasContent(decoder)) {
			return malformedDiagnostic('Collaboration protocol frame has trailing bytes');
		}
		return { ok: true, value: message };
	} catch {
		return malformedDiagnostic('Collaboration protocol frame is malformed');
	}
}

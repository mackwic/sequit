import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';

import {
	type AcceptedMessage,
	COLLAB_PROTOCOL_VERSION,
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
	ProposalIntent,
	type ProposalMessage,
	type ProtocolDiagnostic,
	ProtocolDiagnosticCode,
	type ProtocolErrorMessage,
	type RejectedMessage,
	type SyncRequestMessage,
	type SyncResponseMessage,
} from '../../src/lib/collaboration/protocol';

const cycleDiagnostic: ProtocolDiagnostic = {
	code: 'cycle',
	message: 'Cycle detected: a -> b -> a',
	path: ['relations'],
};

const messages: readonly [
	SyncRequestMessage,
	SyncResponseMessage,
	ProposalMessage,
	ProposalMessage,
	AcceptedMessage,
	AcceptedMessage,
	RejectedMessage,
	ProtocolErrorMessage,
] = [
	{
		type: CollabMessageKind.SyncRequest,
		lastCommit: 0,
		stateVector: new Uint8Array([0]),
	},
	{
		type: CollabMessageKind.SyncResponse,
		commit: 7,
		update: new Uint8Array([1, 2]),
		stateVector: new Uint8Array([3]),
	},
	{
		type: CollabMessageKind.Proposal,
		proposalId: 'p-1',
		intent: ProposalIntent.Initialize,
		update: new Uint8Array([4]),
	},
	{
		type: CollabMessageKind.Proposal,
		proposalId: 'p-2',
		intent: ProposalIntent.Change,
		update: new Uint8Array([5]),
	},
	{
		type: CollabMessageKind.Accepted,
		proposalId: 'p-2',
		commit: 8,
		update: new Uint8Array([6]),
		stateVector: new Uint8Array([7]),
	},
	{
		type: CollabMessageKind.Accepted,
		commit: 9,
		update: new Uint8Array(),
		stateVector: new Uint8Array(),
	},
	{
		type: CollabMessageKind.Rejected,
		proposalId: 'p-3',
		diagnostics: [cycleDiagnostic],
	},
	{ type: CollabMessageKind.ProtocolError, message: 'unreadable frame' },
];

function expectFailure(frame: Uint8Array, code: ProtocolDiagnosticCode): void {
	expect(decodeCollabMessage(frame)).toMatchObject({
		ok: false,
		diagnostics: [{ code }],
	});
}

function requiredMessage(index: number): CollabMessage {
	const message = messages[index];
	if (message === undefined) throw new Error(`Missing protocol message fixture at index ${index}`);
	return message;
}

function rejectedFrame(diagnosticsJson: string): Uint8Array {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, COLLAB_PROTOCOL_VERSION);
	encoding.writeVarUint(encoder, 4);
	encoding.writeVarString(encoder, 'proposal-id');
	encoding.writeVarString(encoder, diagnosticsJson);
	return encoding.toUint8Array(encoder);
}

describe('collaboration protocol codec', () => {
	it('round-trips every message kind', () => {
		for (const message of messages) {
			expect(decodeCollabMessage(encodeCollabMessage(message))).toEqual({
				ok: true,
				value: message,
			});
		}
	});

	it('an empty frame is malformed', () => {
		expectFailure(new Uint8Array(), ProtocolDiagnosticCode.MalformedProtocolFrame);
	});

	it('an unsupported protocol version is rejected', () => {
		const result = decodeCollabMessage(new Uint8Array([COLLAB_PROTOCOL_VERSION + 1, 0]));
		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: ProtocolDiagnosticCode.UnsupportedProtocolVersion,
					message: 'Unsupported collaboration protocol version: 2',
					path: ['protocol', 'version'],
				},
			],
		});
	});

	it('an unknown message kind is rejected', () => {
		const result = decodeCollabMessage(new Uint8Array([COLLAB_PROTOCOL_VERSION, 99]));
		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: ProtocolDiagnosticCode.UnknownMessageKind,
					message: 'Unknown collaboration message kind: 99',
					path: ['protocol', 'kind'],
				},
			],
		});
	});

	it('a truncated body of each kind is malformed', () => {
		const oneMessagePerKind = [messages[0], messages[1], messages[2], ...messages.slice(4)];
		for (const message of oneMessagePerKind) {
			const encoded = encodeCollabMessage(message);
			expectFailure(encoded.slice(0, -1), ProtocolDiagnosticCode.MalformedProtocolFrame);
		}

		expectFailure(
			new Uint8Array([COLLAB_PROTOCOL_VERSION, 2, 0, 2, 0]),
			ProtocolDiagnosticCode.MalformedProtocolFrame,
		);
	});

	it('trailing bytes after a valid body are malformed', () => {
		const encoded = encodeCollabMessage(requiredMessage(0));
		const withTrailingByte = new Uint8Array(encoded.length + 1);
		withTrailingByte.set(encoded);
		withTrailingByte[encoded.length] = 42;
		expect(decodeCollabMessage(withTrailingByte)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: ProtocolDiagnosticCode.MalformedProtocolFrame,
					message: 'Collaboration protocol frame has trailing bytes',
					path: ['protocol'],
				},
			],
		});
	});

	it('wrong-shape rejected-diagnostics JSON is malformed', () => {
		const wrongShapes = [
			'not JSON',
			'{}',
			'[1]',
			'[null]',
			'[[]]',
			'[{}]',
			'[{"code":"code"}]',
			'[{"code":"code","message":"message"}]',
			'[{"code":1,"message":"message","path":[]}]',
			'[{"code":"code","message":1,"path":[]}]',
			'[{"code":"code","message":"message","path":"path"}]',
			'[{"code":"code","message":"message","path":[1]}]',
		];
		for (const wrongShape of wrongShapes) {
			expectFailure(rejectedFrame(wrongShape), ProtocolDiagnosticCode.MalformedProtocolFrame);
		}
	});
});

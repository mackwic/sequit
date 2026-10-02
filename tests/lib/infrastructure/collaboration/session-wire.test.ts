import { decode, encode } from 'cborg';
import { describe, expect, it } from 'vitest';

import {
	GroupState,
	LaneOrientation,
	LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import {
	CommandRefusalCode,
	ConflictCode,
	SessionFailureCode,
} from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import {
	decodeSessionEnvelope,
	decodeSessionMessage,
	encodeSessionMessage,
	LEGACY_SESSION_WIRE_VERSION,
	SESSION_FRAME_LIMIT,
	SESSION_WIRE_VERSION,
	type SessionMessage,
	SessionMessageKind,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import { wireObject } from '../../../../src/lib/infrastructure/collaboration/wire-values';
import {
	SharedCommandKind,
	SharedElementKind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';

const target = { kind: SharedElementKind.Group, id: 'G' } as const;
const commandMessages: SessionMessage[] = [
	{ type: SessionMessageKind.Sync, payload: new Uint8Array([0, 1, 0]) },
	{ type: SessionMessageKind.Change, update: new Uint8Array([0, 0]) },
	{
		type: SessionMessageKind.Change,
		id: 'text',
		sessionId: 'session',
		update: new Uint8Array([0, 0]),
		target: { kind: SharedElementKind.Node, id: 'A' },
		field: 'markdown',
		textId: { client: 7, clock: 42 },
	},
	{
		type: SessionMessageKind.Change,
		id: 'gesture',
		sessionId: 'session',
		sequence: 1,
		commands: [
			{ op: SharedCommandKind.Create, target, properties: { label: 'Groupe' } },
			{ op: SharedCommandKind.Update, target, set: { state: GroupState.Closed }, unset: [] },
			{ op: SharedCommandKind.Delete, target: { kind: SharedElementKind.Node, id: 'A' } },
			{
				op: SharedCommandKind.Delete,
				target: { kind: SharedElementKind.Nature, id: 'N' },
				replacementId: 'replacement',
			},
			{ op: SharedCommandKind.Group, id: 'G', label: 'Groupe', members: ['A', 'B'] },
			{ op: SharedCommandKind.Ungroup, id: 'G' },
			{ op: SharedCommandKind.Move, ids: ['A', 'B'], groupId: 'G' },
			{ op: SharedCommandKind.Move, ids: ['A'] },
			{
				op: SharedCommandKind.UpdateLayout,
				layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
			},
			{
				op: SharedCommandKind.UpdateLanes,
				lanes: {
					laneOrientation: LaneOrientation.Transverse,
					lanes: [
						{ id: 'S', label: 'Sales', layoutOrder: 'a0' },
						{ id: 'C', label: 'Customer', layoutOrder: 'a1' },
					],
				},
				transfers: { old: 'S' },
			},
			{ op: SharedCommandKind.UpdateLanes },
		],
	},
	{ type: SessionMessageKind.Commit, commit: 1, update: new Uint8Array([0, 0]) },
	{ type: SessionMessageKind.Commit, id: 'gesture', commit: 1, update: new Uint8Array([0, 0]) },
	{
		type: SessionMessageKind.Reject,
		code: SessionFailureCode.InvalidDocument,
		reason: { code: SessionFailureCode.InvalidDocument, details: ['Invalid document'] },
	},
	{
		type: SessionMessageKind.Retry,
		code: SessionFailureCode.StorageUnavailable,
		reason: { code: SessionFailureCode.StorageUnavailable },
	},
	{
		type: SessionMessageKind.Conflict,
		code: ConflictCode.CommandConflict,
		reason: { code: CommandRefusalCode.IdentifierExists },
		id: 'command',
		lastAcceptedSequence: 3,
	},
	{
		type: SessionMessageKind.Conflict,
		code: ConflictCode.TextTargetGone,
		id: 'text',
		target: { kind: SharedElementKind.Node, id: 'A' },
	},
	{
		type: SessionMessageKind.Presence,
		participants: [
			{
				clientId: 10,
				name: 'Alice',
				color: '#aa0000',
				selected: [{ kind: SharedElementKind.Node, id: 'A' }],
			},
		],
	},
];
const v5CompatibleMessages = commandMessages.filter(
	(message) =>
		message.type !== SessionMessageKind.Reject &&
		message.type !== SessionMessageKind.Retry &&
		message.type !== SessionMessageKind.Conflict,
);

function frame(message: unknown): Uint8Array {
	return encode([SESSION_WIRE_VERSION, message]);
}
function legacyFrame(message: unknown): Uint8Array {
	return encode([LEGACY_SESSION_WIRE_VERSION, message]);
}

function invalidCommand(command: unknown): Uint8Array {
	return frame({
		type: 'change',
		id: 'gesture',
		sessionId: 'session',
		sequence: 1,
		commands: [command],
	});
}

describe('CBOR session protocol', () => {
	it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
		'requires positive safe command sequence %s',
		(sequence) => {
			expect(() =>
				decodeSessionMessage(
					frame({
						type: 'change',
						id: 'command',
						sessionId: 'session',
						sequence,
						commands: [{ op: 'ungroup', id: 'G' }],
					}),
				),
			).toThrow();
		},
	);
	it.each(commandMessages)(
		'transports $type with binary updates and typed operations',
		(message) => {
			const bytes = encodeSessionMessage(message);
			expect(decode(bytes)).toEqual([SESSION_WIRE_VERSION, message]);
			expect(decodeSessionMessage(bytes)).toEqual(message);
		},
	);
	it.each(v5CompatibleMessages)(
		'preserves v5 $type fields through compatibility encoding',
		(message) => {
			expect(
				decodeSessionEnvelope(encodeSessionMessage(message, LEGACY_SESSION_WIRE_VERSION)),
			).toEqual({ version: LEGACY_SESSION_WIRE_VERSION, message });
		},
	);

	it('converts v5 rejects and conflicts into structured v6 reasons', () => {
		expect(
			decodeSessionEnvelope(
				legacyFrame({ type: SessionMessageKind.Reject, message: 'Legacy reject' }),
			),
		).toEqual({
			version: LEGACY_SESSION_WIRE_VERSION,
			message: {
				type: SessionMessageKind.Reject,
				code: SessionFailureCode.InvalidMessage,
				reason: { code: SessionFailureCode.InvalidMessage, details: ['Legacy reject'] },
			},
		});
		expect(
			decodeSessionEnvelope(
				legacyFrame({
					type: SessionMessageKind.Reject,
					code: SessionFailureCode.InvalidDocument,
					message: 'Legacy document failure',
				}),
			),
		).toEqual({
			version: LEGACY_SESSION_WIRE_VERSION,
			message: {
				type: SessionMessageKind.Reject,
				code: SessionFailureCode.InvalidDocument,
				reason: {
					code: SessionFailureCode.InvalidDocument,
					details: ['Legacy document failure'],
				},
			},
		});
		expect(
			decodeSessionEnvelope(
				legacyFrame({
					type: SessionMessageKind.Retry,
					code: SessionFailureCode.StorageUnavailable,
					message: 'Ancien message traduit',
				}),
			).message,
		).toEqual({
			type: SessionMessageKind.Retry,
			code: SessionFailureCode.StorageUnavailable,
			reason: { code: SessionFailureCode.StorageUnavailable },
		});
		expect(
			decodeSessionEnvelope(
				legacyFrame({
					type: SessionMessageKind.Reject,
					code: SessionFailureCode.CorruptCommandReceipt,
					message: 'Reçu de commande corrompu pour la session session-42.',
				}),
			).message,
		).toEqual({
			type: SessionMessageKind.Reject,
			code: SessionFailureCode.CorruptCommandReceipt,
			reason: { code: SessionFailureCode.CorruptCommandReceipt, sessionId: 'session-42' },
		});
		expect(
			decodeSessionEnvelope(
				legacyFrame({
					type: SessionMessageKind.Conflict,
					code: ConflictCode.CommandConflict,
					message: 'Moved',
					id: 'command',
					lastAcceptedSequence: 3,
				}),
			).message,
		).toEqual({
			type: SessionMessageKind.Conflict,
			code: ConflictCode.CommandConflict,
			reason: {
				code: CommandRefusalCode.InvalidDocument,
				details: ['Moved'],
			},
			id: 'command',
			lastAcceptedSequence: 3,
		});
		expect(
			decodeSessionEnvelope(
				legacyFrame({
					type: SessionMessageKind.Conflict,
					code: ConflictCode.TextTargetGone,
					message: 'Deleted box',
					id: 'text',
					target: { kind: SharedElementKind.Node, id: 'A' },
				}),
			).message,
		).toEqual({
			type: SessionMessageKind.Conflict,
			code: ConflictCode.TextTargetGone,
			id: 'text',
			target: { kind: SharedElementKind.Node, id: 'A' },
		});
	});

	it.each([
		{
			code: SessionFailureCode.InvalidMessage,
			message: 'Legacy invalid message',
			reason: {
				code: SessionFailureCode.InvalidMessage,
				details: ['Legacy invalid message'],
			},
		},
		{
			code: SessionFailureCode.CommandGap,
			message: 'Legacy retry',
			reason: { code: SessionFailureCode.CommandGap },
		},
		{
			code: SessionFailureCode.RepeatedCommandRefusal,
			message: 'Legacy repeated refusal',
			reason: { code: SessionFailureCode.RepeatedCommandRefusal },
		},
	])(
		'maps v5 rejection codes with code-specific detail handling: $code',
		({ code, message, reason }) => {
			expect(
				decodeSessionEnvelope(legacyFrame({ type: SessionMessageKind.Reject, code, message }))
					.message,
			).toEqual({ type: SessionMessageKind.Reject, code, reason });
		},
	);
	it('serves v5 peers with neutral reasons and preserves v5 identified-text fields', () => {
		const rejected = {
			type: SessionMessageKind.Reject,
			code: SessionFailureCode.InvalidDocument,
			reason: {
				code: SessionFailureCode.InvalidDocument,
				details: ['Stored document; is invalid', 'Secondary detail'],
			},
		} as const;
		const legacyRejectionFrame = encodeSessionMessage(rejected, LEGACY_SESSION_WIRE_VERSION);
		expect(decode(legacyRejectionFrame)).toEqual([
			LEGACY_SESSION_WIRE_VERSION,
			{
				type: SessionMessageKind.Reject,
				code: SessionFailureCode.InvalidDocument,
				message: 'invalid-document: ["Stored document; is invalid","Secondary detail"]',
			},
		]);
		expect(decodeSessionEnvelope(legacyRejectionFrame)).toEqual({
			version: LEGACY_SESSION_WIRE_VERSION,
			message: rejected,
		});
		const emptyRejection = {
			type: SessionMessageKind.Reject,
			code: SessionFailureCode.InvalidDocument,
			reason: { code: SessionFailureCode.InvalidDocument, details: [] },
		} as const;
		expect(
			decodeSessionMessage(encodeSessionMessage(emptyRejection, LEGACY_SESSION_WIRE_VERSION)),
		).toEqual(emptyRejection);

		const commandConflict = {
			type: SessionMessageKind.Conflict,
			code: ConflictCode.InvalidCommand,
			reason: { code: CommandRefusalCode.IdentifierExists },
			id: 'command',
			lastAcceptedSequence: 4,
		} as const;
		const legacyConflictFrame = encodeSessionMessage(commandConflict, LEGACY_SESSION_WIRE_VERSION);
		expect(decode(legacyConflictFrame)).toEqual([
			LEGACY_SESSION_WIRE_VERSION,
			{
				type: SessionMessageKind.Conflict,
				code: ConflictCode.InvalidCommand,
				message: 'identifier-exists',
				id: 'command',
				lastAcceptedSequence: 4,
			},
		]);
		expect(decodeSessionEnvelope(legacyConflictFrame).message).toEqual({
			type: SessionMessageKind.Conflict,
			code: ConflictCode.InvalidCommand,
			reason: { code: CommandRefusalCode.InvalidDocument, details: ['identifier-exists'] },
			id: 'command',
			lastAcceptedSequence: 4,
		});

		const receiptRejection = {
			type: SessionMessageKind.Reject,
			code: SessionFailureCode.CorruptCommandReceipt,
			reason: { code: SessionFailureCode.CorruptCommandReceipt, sessionId: 'session-42' },
		} as const;
		const legacyReceiptFrame = encodeSessionMessage(receiptRejection, LEGACY_SESSION_WIRE_VERSION);
		expect(decode(legacyReceiptFrame)).toEqual([
			LEGACY_SESSION_WIRE_VERSION,
			{
				type: SessionMessageKind.Reject,
				code: SessionFailureCode.CorruptCommandReceipt,
				message: 'corrupt-command-receipt:session-42',
			},
		]);
		expect(decodeSessionEnvelope(legacyReceiptFrame).message).toEqual(receiptRejection);

		const textConflict = {
			type: SessionMessageKind.Conflict,
			code: ConflictCode.TextTargetGone,
			id: 'text',
			target: { kind: SharedElementKind.Node, id: 'A' },
		} as const;
		const legacyTextConflictFrame = encodeSessionMessage(textConflict, LEGACY_SESSION_WIRE_VERSION);
		expect(decode(legacyTextConflictFrame)).toEqual([
			LEGACY_SESSION_WIRE_VERSION,
			{
				type: SessionMessageKind.Conflict,
				code: ConflictCode.TextTargetGone,
				message: ConflictCode.TextTargetGone,
				id: 'text',
				target: { kind: SharedElementKind.Node, id: 'A' },
			},
		]);
		expect(decodeSessionEnvelope(legacyTextConflictFrame).message).toEqual(textConflict);

		const identifiedText = {
			type: SessionMessageKind.Change,
			id: 'text',
			sessionId: 'session',
			update: new Uint8Array([0, 0]),
			target: { kind: SharedElementKind.Node, id: 'A' },
			field: 'markdown',
			textId: { client: 7, clock: 42 },
		} as const;
		const legacyTextFrame = encodeSessionMessage(identifiedText, LEGACY_SESSION_WIRE_VERSION);
		expect(decode(legacyTextFrame)).toEqual([LEGACY_SESSION_WIRE_VERSION, identifiedText]);
		expect(decodeSessionEnvelope(legacyTextFrame)).toEqual({
			version: LEGACY_SESSION_WIRE_VERSION,
			message: identifiedText,
		});
		expect(() =>
			decodeSessionEnvelope(encode([4, { type: SessionMessageKind.Sync, payload: [] }])),
		).toThrow('Unsupported session version');
	});
	it('rejects v5 protocol values that are no longer accepted as legacy messages', () => {
		expect(() =>
			decodeSessionEnvelope(
				legacyFrame({
					type: SessionMessageKind.Reject,
					code: 'unknown-failure',
					message: 'Legacy failure',
				}),
			),
		).toThrow('Unknown session failure code');
		expect(() =>
			decodeSessionEnvelope(
				legacyFrame({
					type: SessionMessageKind.Retry,
					code: SessionFailureCode.CommandGap,
					message: 'Legacy retry',
					extra: true,
				}),
			),
		).toThrow('Unexpected message property');
	});

	const invalidStructuredMessages = [
		{
			type: SessionMessageKind.Reject,
			code: SessionFailureCode.InvalidMessage,
			reason: { code: 'unknown-failure', details: [] },
		},
		{
			type: SessionMessageKind.Reject,
			code: 'unknown-failure',
			reason: { code: SessionFailureCode.InvalidMessage, details: [] },
		},
		{
			type: SessionMessageKind.Reject,
			code: SessionFailureCode.InvalidMessage,
			reason: { code: SessionFailureCode.InvalidMessage, details: [], extra: true },
		},
		{
			type: SessionMessageKind.Retry,
			code: SessionFailureCode.InvalidDocument,
			reason: { code: SessionFailureCode.InvalidMessage, details: [] },
		},
		{
			type: SessionMessageKind.Conflict,
			code: 'unknown-conflict',
			reason: { code: CommandRefusalCode.IdentifierExists },
			id: 'command',
			lastAcceptedSequence: 3,
		},
		{
			type: SessionMessageKind.Conflict,
			code: ConflictCode.CommandConflict,
			reason: { code: 'unknown-refusal' },
			id: 'command',
			lastAcceptedSequence: 3,
		},
		{
			type: SessionMessageKind.Conflict,
			code: ConflictCode.CommandConflict,
			reason: { code: CommandRefusalCode.IdentifierExists, extra: true },
			id: 'command',
			lastAcceptedSequence: 3,
		},
		{
			type: SessionMessageKind.Conflict,
			code: ConflictCode.TextTargetGone,
			message: 'Unexpected legacy text',
			id: 'text',
			target: { kind: SharedElementKind.Node, id: 'A' },
		},
	];

	it.each(invalidStructuredMessages)(
		'rejects invalid structured reasons on decode: %j',
		(message) => {
			expect(() => decodeSessionMessage(frame(message))).toThrow();
		},
	);

	it.each(invalidStructuredMessages)(
		'rejects invalid structured reasons on encode: %j',
		(message) => {
			expect(() => {
				Reflect.apply(encodeSessionMessage, undefined, [message]);
			}).toThrow();
		},
	);

	it.each([
		{
			code: ConflictCode.CommandConflict,
			reason: { code: CommandRefusalCode.IdentifierExists },
			lastAcceptedSequence: 0,
		},
		{
			code: ConflictCode.CommandConflict,
			reason: { code: CommandRefusalCode.IdentifierExists },
			id: 'command',
		},
		{
			code: ConflictCode.InvalidCommand,
			reason: { code: CommandRefusalCode.IdentifierExists },
			id: 'command',
			lastAcceptedSequence: -1,
		},
		{
			code: ConflictCode.CommandConflict,
			reason: { code: CommandRefusalCode.IdentifierExists },
			id: 'command',
			lastAcceptedSequence: 0,
			targetId: 'B',
		},
	])('rejects conflicts without exactly one command repair position: %j', (invalid) => {
		expect(() =>
			decodeSessionMessage(frame({ type: SessionMessageKind.Conflict, ...invalid })),
		).toThrow();
	});

	it('requires IDs for commands and validates IDs on text updates', () => {
		expect(() => decodeSessionMessage(frame({ type: 'change', commands: [] }))).toThrow();
		expect(() =>
			decodeSessionMessage(frame({ type: 'change', id: 'é'.repeat(65), update: new Uint8Array() })),
		).toThrow('ID must contain');
		for (const id of ['', 'é'.repeat(65)]) {
			expect(() =>
				decodeSessionMessage(frame({ type: 'change', id, commands: [{ op: 'ungroup', id: 'G' }] })),
			).toThrow('ID must contain');
		}
	});

	it.each([
		null,
		[],
		{ type: 'move' },
		{ type: 'sync', payload: 'base64' },
		{ type: 'commit', commit: -1, update: new Uint8Array() },
		{ type: 'commit', commit: 0.5, update: new Uint8Array() },
		{ type: 'reject', code: 'unknown', reason: { code: 'unknown', details: [] } },
		{
			type: 'retry',
			code: SessionFailureCode.StorageUnavailable,
			reason: { code: SessionFailureCode.StorageUnavailable, extra: true },
		},
		{ type: 'presence', participants: [{ clientId: 1, name: 'A', color: '#000', selected: 5 }] },
		{ type: 'presence', participants: [{ clientId: 1, name: 'A', color: '#000', selected: [5] }] },
	])('rejects malformed messages before dispatch: %j', (message) => {
		expect(() => decodeSessionMessage(frame(message))).toThrow();
	});

	it.each([
		{ op: 'move', id: 'A' },
		{ op: 'create', target: { kind: 'unknown', id: 'A' }, properties: {} },
		{ op: 'update', target, set: { color: 5 }, unset: [] },
		{ op: 'update', target, set: [], unset: [] },
		{ op: 'delete', target, unrecognized: true },
		{ op: 'group', id: 'G', label: 'G', members: null },
		{ op: 'updateLayout', layout: { direction: 'left-to-right', bias: 'top' } },
		{ op: 'updateLayout', layout: { direction: 'unknown', bias: 'left' } },
		{ op: 'updateLanes', lanes: { laneOrientation: 'diagonal', lanes: [] } },
		{ op: 'updateLanes', lanes: { laneOrientation: 'parallel', lanes: [{ id: 'S', label: 'S' }] } },
		{
			op: 'updateLanes',
			lanes: { laneOrientation: 'parallel', lanes: [{ id: 'S', label: 'S', layoutOrder: '!' }] },
		},
		{ op: 'updateLanes', transfers: { old: 5 } },
	])('rejects malformed commands before execution: %j', (command) => {
		expect(() => decodeSessionMessage(invalidCommand(command))).toThrow();
	});

	it('bounds frames and rejects unknown versions, extra frames and oversized batches', () => {
		expect(() => decodeSessionMessage(new Uint8Array(SESSION_FRAME_LIMIT + 1))).toThrow(
			'too large',
		);
		expect(() =>
			encodeSessionMessage({
				type: SessionMessageKind.Change,
				update: new Uint8Array(SESSION_FRAME_LIMIT),
			}),
		).toThrow('too large');
		expect(() => decodeSessionMessage(encode([999, {}]))).toThrow('Unsupported');
		expect(() => decodeSessionMessage(encode({}))).toThrow('envelope');
		const valid = frame({
			type: SessionMessageKind.Reject,
			code: SessionFailureCode.InvalidMessage,
			reason: { code: SessionFailureCode.InvalidMessage, details: ['error'] },
		});
		expect(() => decodeSessionMessage(new Uint8Array([...valid, 0]))).toThrow();
		expect(() =>
			decodeSessionMessage(
				frame({
					type: 'change',
					id: 'gesture',
					commands: Array.from({ length: 101 }, () => ({ op: 'ungroup', id: 'G' })),
				}),
			),
		).toThrow('1 to 100');
	});

	it('does not accept binary values where an object is required', () => {
		expect(() => decodeSessionMessage(frame(new Uint8Array([0])))).toThrow('plain object');
	});
});

it('rejects null-prototype records and class instances outside the wire shape', () => {
	const plain: unknown = Object.assign(Object.create(null), {
		type: SessionMessageKind.Reject,
		message: 'Refus',
	});
	expect(() => {
		wireObject(plain);
	}).toThrow();
	class UnsupportedRecord {
		readonly message = 'Refus';
	}
	expect(() => {
		wireObject(new UnsupportedRecord());
	}).toThrow();
});

it.each([
	{ type: 'change', id: 'gesture', commands: {} },
	{ type: 'presence', participants: {} },
	{ type: 'commit', commit: '1', update: new Uint8Array([0, 0]) },
])('rejects invalid container and counter types at the protocol boundary', (message) => {
	expect(() => decodeSessionMessage(frame(message))).toThrow();
});

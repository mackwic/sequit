import { decode, encode } from 'cborg';
import { describe, expect, it } from 'vitest';

import {
	GroupState,
	LaneOrientation,
	LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import {
	ConflictCode,
	SessionFailureCode,
} from '../../../../src/lib/infrastructure/collaboration/session-failure';
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
	{ type: SessionMessageKind.Commit, commit: 1, id: 'gesture', update: new Uint8Array([0, 0]) },
	{ type: SessionMessageKind.Reject, message: 'Cette relation créerait un cycle.' },
	{
		type: SessionMessageKind.Reject,
		code: SessionFailureCode.InvalidDocument,
		message: 'Invalid document',
	},
	{
		type: SessionMessageKind.Retry,
		code: SessionFailureCode.StorageUnavailable,
		message: 'Try again',
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

function frame(message: unknown): Uint8Array {
	return encode([SESSION_WIRE_VERSION, message]);
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

	it('accepts versioned conflicts while preserving the v4 terminal contract', () => {
		const refusal = {
			type: SessionMessageKind.Conflict,
			id: 'command',
			code: ConflictCode.CommandConflict,
			message: 'Moved',
			lastAcceptedSequence: 3,
		} as const;
		const staleText = {
			type: SessionMessageKind.Conflict,
			code: ConflictCode.TextTargetGone,
			id: 'text',
			message: 'Deleted box',
			target: { kind: SharedElementKind.Node, id: 'A' },
		} as const;
		expect(decodeSessionMessage(encodeSessionMessage(staleText))).toEqual(staleText);
		expect(decodeSessionMessage(encodeSessionMessage(refusal))).toEqual(refusal);
		expect(() => encodeSessionMessage(refusal, LEGACY_SESSION_WIRE_VERSION)).toThrow(
			'Legacy clients',
		);
		const oldText = encodeSessionMessage(
			{
				type: SessionMessageKind.Change,
				id: 'text',
				sessionId: 'session',
				update: new Uint8Array([0, 0]),
				target: { kind: SharedElementKind.Node, id: 'A' },
				field: 'markdown',
				textId: { client: 7, clock: 42 },
			},
			LEGACY_SESSION_WIRE_VERSION,
		);
		expect(decodeSessionEnvelope(oldText)).toEqual({
			version: LEGACY_SESSION_WIRE_VERSION,
			message: { type: SessionMessageKind.Change, update: new Uint8Array([0, 0]) },
		});
		expect(() =>
			decodeSessionMessage(frame({ type: 'conflict', code: 'unknown', message: 'Moved' })),
		).toThrow('Unknown conflict code');
		expect(() => decodeSessionEnvelope(encode([LEGACY_SESSION_WIRE_VERSION, refusal]))).toThrow(
			'Unsupported legacy message',
		);
		const oldCommand = {
			type: SessionMessageKind.Change,
			id: 'legacy-command',
			sessionId: 'legacy-session',
			sequence: 1,
			commands: [{ op: SharedCommandKind.Ungroup, id: 'G' }],
		} as const;
		expect(
			decodeSessionEnvelope(encodeSessionMessage(oldCommand, LEGACY_SESSION_WIRE_VERSION)),
		).toEqual({
			version: LEGACY_SESSION_WIRE_VERSION,
			message: oldCommand,
		});
		expect(() =>
			decodeSessionEnvelope(
				encode([
					LEGACY_SESSION_WIRE_VERSION,
					{
						type: SessionMessageKind.Change,
						id: 'not-a-legacy-text-id',
						update: new Uint8Array([0, 0]),
						sessionId: 'session',
						target: { kind: SharedElementKind.Node, id: 'A' },
						field: 'markdown',
						textId: { client: 7, clock: 42 },
					},
				]),
			),
		).toThrow('Unsupported legacy message');
	});

	it.each([
		{ code: ConflictCode.CommandConflict, message: 'Moved', lastAcceptedSequence: 0 },
		{ code: ConflictCode.CommandConflict, message: 'Moved', id: 'command' },
		{
			code: ConflictCode.InvalidCommand,
			message: 'Cycle',
			id: 'command',
			lastAcceptedSequence: -1,
		},
		{
			code: ConflictCode.CommandConflict,
			message: 'Moved',
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
		{ type: 'reject', message: 5 },
		{ type: 'retry', message: 'Try again', code: 'unknown' },
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
		const valid = frame({ type: 'reject', message: 'error' });
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

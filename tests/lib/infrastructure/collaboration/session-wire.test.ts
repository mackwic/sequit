import { decode, encode } from 'cborg';
import { describe, expect, it } from 'vitest';

import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import {
	decodeSessionMessage,
	encodeSessionMessage,
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

const target = { kind: SharedElementKind.Group, id: 'G' };
const commandMessages: SessionMessage[] = [
	{ type: SessionMessageKind.Sync, payload: new Uint8Array([0, 1, 0]) },
	{ type: SessionMessageKind.Change, update: new Uint8Array([0, 0]) },
	{
		type: SessionMessageKind.Change,
		id: 'gesture',
		commands: [
			{ op: SharedCommandKind.Create, target, properties: { label: 'Groupe' } },
			{ op: SharedCommandKind.Update, target, set: { state: 'closed' }, unset: [] },
			{ op: SharedCommandKind.Delete, target },
			{ op: SharedCommandKind.Delete, target, replacementId: 'replacement' },
			{ op: SharedCommandKind.Group, id: 'G', label: 'Groupe', members: ['A', 'B'] },
			{ op: SharedCommandKind.Ungroup, id: 'G' },
			{
				op: SharedCommandKind.UpdateLayout,
				layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
			},
		],
	},
	{ type: SessionMessageKind.Commit, commit: 1, update: new Uint8Array([0, 0]) },
	{ type: SessionMessageKind.Commit, commit: 1, id: 'gesture', update: new Uint8Array([0, 0]) },
	{ type: SessionMessageKind.Reject, message: 'Cette relation créerait un cycle.' },
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
	return frame({ type: 'change', id: 'gesture', commands: [command] });
}

describe('CBOR session protocol', () => {
	it.each(commandMessages)(
		'transports $type with binary updates and typed operations',
		(message) => {
			const bytes = encodeSessionMessage(message);
			expect(decode(bytes)).toEqual([SESSION_WIRE_VERSION, message]);
			expect(decodeSessionMessage(bytes)).toEqual(message);
		},
	);

	it('requires IDs for commands but rejects IDs on text updates', () => {
		expect(() => decodeSessionMessage(frame({ type: 'change', commands: [] }))).toThrow();
		expect(() =>
			decodeSessionMessage(frame({ type: 'change', id: 'unexpected', update: new Uint8Array() })),
		).toThrow('Unexpected message property');
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

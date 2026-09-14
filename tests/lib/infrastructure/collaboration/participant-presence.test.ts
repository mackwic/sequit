import { describe, expect, it } from 'vitest';

import { readParticipantPresence } from '../../../../src/lib/infrastructure/collaboration/participant-presence';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	SessionMessageKind,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import { SharedElementKind } from '../../../../src/lib/infrastructure/document/shared-document-command';

const target = { kind: SharedElementKind.Node, id: 'A' };
const base = { clientId: 1, name: 'Alice', color: '#123456', selected: [target] };
const selection = {
	target,
	field: 'markdown',
	anchor: new Uint8Array([0, 1]),
	head: new Uint8Array([0, 2]),
};
describe('ephemeral awareness protocol', () => {
	it('bounds the largest attachment and room frame while keeping document-independent presence', () => {
		const largeTarget = { kind: SharedElementKind.Document, id: 'a'.repeat(128) };
		const participant = readParticipantPresence({
			clientId: Number.MAX_SAFE_INTEGER,
			name: '漢'.repeat(1000),
			color: '漢'.repeat(1000),
			selected: Array.from({ length: 1000 }, () => largeTarget),
			pointer: { x: 0.125, y: -0.125 },
			textSelection: {
				target: largeTarget,
				field: 'description',
				anchor: new Uint8Array(512),
				head: new Uint8Array(512),
			},
		});
		expect(participant.selected).toHaveLength(16);
		expect(
			encodeSessionMessage({ type: SessionMessageKind.Presence, participants: [participant] })
				.byteLength,
		).toBeLessThan(6 * 1024);
		const room = encodeSessionMessage({
			type: SessionMessageKind.Presence,
			participants: Array.from({ length: 129 }, () => participant),
		});
		expect(room.byteLength).toBeLessThan(1024 * 1024);
		expect(decodeSessionMessage(room)).toMatchObject({
			participants: Array.from({ length: 128 }, () => participant),
		});
	});
	it('round trips binary relative positions, document coordinates and typed selections through CBOR', () => {
		const message = {
			type: SessionMessageKind.Presence as const,
			participants: [{ ...base, pointer: { x: -24.5, y: 987.25 }, textSelection: selection }],
		};
		expect(decodeSessionMessage(encodeSessionMessage(message))).toEqual(message);
		expect(readParticipantPresence({ ...base, pointer: null, textSelection: null })).toEqual({
			...base,
			pointer: null,
			textSelection: null,
		});
		expect(readParticipantPresence(base)).toEqual(base);
	});
	it.each([NaN, Infinity, -Infinity, 10_000_001, '10'])(
		'rejects invalid pointer coordinate %s',
		(x) => {
			expect(() => readParticipantPresence({ ...base, pointer: { x, y: 0 } })).toThrow();
		},
	);
	it.each([
		{ selected: ['A'] },
		{ textSelection: { ...selection, field: 'css' } },
		{ textSelection: { ...selection, anchor: new Uint8Array() } },
		{ textSelection: { ...selection, head: new Uint8Array(513) } },
		{ textSelection: { ...selection, anchor: 'invalid' } },
		{ pointer: { x: 0, y: 1, z: 2 } },
	])('rejects invalid awareness payload %#', (patch) => {
		expect(() => readParticipantPresence({ ...base, ...patch })).toThrow();
	});
});

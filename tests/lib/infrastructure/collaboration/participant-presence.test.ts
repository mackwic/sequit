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
		{ selected: Array.from({ length: 1001 }, () => target) },
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

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	decodeSessionMessage,
	encodeSessionMessage,
	type SessionMessage,
	SessionMessageKind as Message,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import {
	SharedCommandKind,
	SharedElementKind,
	SharedProperty,
} from '../../../../src/lib/infrastructure/document/shared-document-command';

const bytes = fc.uint8Array({ maxLength: 64 });
const integer = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const id = fc.string({ minLength: 1, maxLength: 32 });
const plain = { noNullPrototype: true };
const messageArbitrary: fc.Arbitrary<SessionMessage> = fc.oneof(
	fc.record({ type: fc.constant(Message.Sync), payload: bytes }, plain),
	fc.record({ type: fc.constant(Message.Initialize), id, update: bytes }, plain),
	fc.record({ type: fc.constant(Message.Change), update: bytes }, plain),
	fc.record({ type: fc.constant(Message.Commit), commit: integer, update: bytes }, plain),
	fc.record({ type: fc.constant(Message.Commit), id, commit: integer, update: bytes }, plain),
	fc.record({ type: fc.constant(Message.Reject), message: fc.string() }, plain),
	fc.record(
		{
			type: fc.constant(Message.Change),
			id,
			sessionId: id,
			sequence: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
			commands: fc.array(
				fc.record(
					{
						op: fc.constant(SharedCommandKind.Update),
						target: fc.record({ kind: fc.constant(SharedElementKind.Node), id }, plain),
						set: fc.record({ color: fc.string() }, plain),
						unset: fc.uniqueArray(
							fc.constantFrom(SharedProperty.GroupId, SharedProperty.Color, SharedProperty.Icon),
							{ maxLength: 3 },
						),
					},
					plain,
				),
				{ minLength: 1, maxLength: 8 },
			),
		},
		plain,
	),
	fc.record(
		{
			type: fc.constant(Message.Presence),
			participants: fc.array(
				fc.record(
					{
						clientId: integer,
						name: fc.string(),
						color: fc.string(),
						selected: fc.array(
							fc.record({ kind: fc.constant(SharedElementKind.Node), id }, plain),
							{ maxLength: 8 },
						),
					},
					plain,
				),
				{ maxLength: 8 },
			),
		},
		plain,
	),
);

describe('generated CBOR session messages', () => {
	it('property: preserves binary updates and element properties through the wire round trip', () => {
		fc.assert(
			fc.property(messageArbitrary, (message) => {
				expect(decodeSessionMessage(encodeSessionMessage(message))).toEqual(message);
			}),
			{ numRuns: 100 },
		);
	});
});

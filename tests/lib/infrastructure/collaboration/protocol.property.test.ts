import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	type CommandRefusal,
	CommandRefusalCode,
	ConflictCode,
	SessionFailureCode,
	type SessionRejection,
} from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import {
	decodeSessionEnvelope,
	decodeSessionMessage,
	encodeSessionMessage,
	LEGACY_SESSION_WIRE_VERSION,
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
const details = fc.array(fc.string(), { maxLength: 8 });
const target = fc.record({ kind: fc.constant(SharedElementKind.Node), id }, plain);
const simpleCommandRefusals: readonly CommandRefusal[] = [
	{ code: CommandRefusalCode.IdentifierExists },
	{ code: CommandRefusalCode.GroupMemberMissing },
	{ code: CommandRefusalCode.ElementsDifferentRegion },
	{ code: CommandRefusalCode.ElementsDifferentLane },
	{ code: CommandRefusalCode.GroupSelectionRequired },
	{ code: CommandRefusalCode.ElementsDifferentGroup },
	{ code: CommandRefusalCode.NatureReplacementRequired },
	{ code: CommandRefusalCode.NatureReplacementDifferent },
	{ code: CommandRefusalCode.UnknownCommand },
	{ code: CommandRefusalCode.DocumentMissing },
	{ code: CommandRefusalCode.MinimumLanes },
	{ code: CommandRefusalCode.LaneNameRequired },
	{ code: CommandRefusalCode.RegionalLanesRequired },
	{ code: CommandRefusalCode.NodesDifferentLane },
	{ code: CommandRefusalCode.NodesDifferentRegion },
	{ code: CommandRefusalCode.InvalidRegionPresentation },
	{ code: CommandRefusalCode.GroupSelfContainment },
];
const commandRefusal: fc.Arbitrary<CommandRefusal> = fc.oneof(
	fc.constantFrom(...simpleCommandRefusals),
	fc.record({ code: fc.constant(CommandRefusalCode.InvalidDocument), details }, plain),
	fc.record({ code: fc.constant(CommandRefusalCode.ElementMissing), target }, plain),
	fc.record({ code: fc.constant(CommandRefusalCode.InvalidLaneId), laneId: id }, plain),
	fc.record(
		{ code: fc.constant(CommandRefusalCode.UnknownDestinationLane), target: fc.string() },
		plain,
	),
	fc.record({ code: fc.constant(CommandRefusalCode.GroupMissing), groupId: id }, plain),
	fc.record({ code: fc.constant(CommandRefusalCode.DuplicateRelationId), relationId: id }, plain),
	fc.record(
		{
			code: fc.constant(CommandRefusalCode.DuplicateRelation),
			from: id,
			to: id,
			relationId: id,
		},
		plain,
	),
);

const sessionRejection: fc.Arbitrary<SessionRejection> = fc.oneof(
	fc.record({ code: fc.constant(SessionFailureCode.InvalidMessage), details }, plain),
	fc.record({ code: fc.constant(SessionFailureCode.InvalidDocument), details }, plain),
	fc.constant({ code: SessionFailureCode.StorageUnavailable }),
	fc.constant({ code: SessionFailureCode.CommandGap }),
	fc.record({ code: fc.constant(SessionFailureCode.CorruptCommandReceipt), sessionId: id }, plain),
	fc.constant({ code: SessionFailureCode.RepeatedCommandRefusal }),
);
const commandChange: fc.Arbitrary<SessionMessage> = fc.record(
	{
		type: fc.constant(Message.Change),
		id,
		sessionId: id,
		sequence: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
		commands: fc.array(
			fc.record(
				{
					op: fc.constant(SharedCommandKind.Update),
					target,
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
);
const commonMessageArbitrary: fc.Arbitrary<SessionMessage> = fc.oneof(
	fc.record({ type: fc.constant(Message.Sync), payload: bytes }, plain),
	fc.record({ type: fc.constant(Message.Initialize), id, update: bytes }, plain),
	fc.record({ type: fc.constant(Message.Change), update: bytes }, plain),
	fc.record(
		{
			type: fc.constant(Message.Change),
			id,
			sessionId: id,
			update: bytes,
			target,
			field: fc.string(),
			textId: fc.record({ client: integer, clock: integer }, plain),
		},
		plain,
	),
	commandChange,
	fc.record({ type: fc.constant(Message.Commit), commit: integer, update: bytes }, plain),
	fc.record({ type: fc.constant(Message.Commit), id, commit: integer, update: bytes }, plain),
	fc.record(
		{
			type: fc.constant(Message.Presence),
			participants: fc.array(
				fc.record(
					{
						clientId: integer,
						name: fc.string(),
						color: fc.string(),
						selected: fc.array(target, { maxLength: 8 }),
					},
					plain,
				),
				{ maxLength: 8 },
			),
		},
		plain,
	),
);
const messageArbitrary: fc.Arbitrary<SessionMessage> = fc.oneof(
	commonMessageArbitrary,
	sessionRejection.map((reason): SessionMessage => ({
		type: Message.Reject,
		code: reason.code,
		reason,
	})),
	sessionRejection.map((reason): SessionMessage => ({
		type: Message.Retry,
		code: reason.code,
		reason,
	})),
	fc.record(
		{
			type: fc.constant(Message.Conflict),
			code: fc.constantFrom(ConflictCode.CommandConflict, ConflictCode.InvalidCommand),
			reason: commandRefusal,
			id,
			lastAcceptedSequence: integer,
		},
		plain,
	),
	fc.record(
		{
			type: fc.constant(Message.Conflict),
			code: fc.constant(ConflictCode.TextTargetGone),
			id,
			target,
		},
		plain,
	),
);

describe('generated CBOR session messages', () => {
	it('property: preserves binary updates and structured reasons through the v6 round trip', () => {
		fc.assert(
			fc.property(messageArbitrary, (message) => {
				expect(decodeSessionMessage(encodeSessionMessage(message))).toEqual(message);
			}),
			{ numRuns: 100 },
		);
	});

	it('property: keeps shared v5 message fields through the legacy round trip', () => {
		fc.assert(
			fc.property(commonMessageArbitrary, (message) => {
				const envelope = decodeSessionEnvelope(
					encodeSessionMessage(message, LEGACY_SESSION_WIRE_VERSION),
				);
				expect(envelope).toEqual({ version: LEGACY_SESSION_WIRE_VERSION, message });
			}),
			{ numRuns: 100 },
		);
	});
});

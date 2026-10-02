import {
	type CommandRefusal,
	CommandRefusalCode,
	PLAIN_COMMAND_REFUSAL_CODES,
	SessionFailureCode,
	type SessionRejection,
} from './session-reasons';
import { readSharedTarget } from './shared-command-codec';
import { wireId, wireKeys, wireObject, wireString, wireStrings } from './wire-values';

/** Refusals that carry parameters besides their code. */
const DETAILED_COMMAND_REFUSAL_CODES = [
	CommandRefusalCode.InvalidDocument,
	CommandRefusalCode.ElementMissing,
	CommandRefusalCode.InvalidLaneId,
	CommandRefusalCode.UnknownDestinationLane,
	CommandRefusalCode.GroupMissing,
	CommandRefusalCode.DuplicateRelationId,
	CommandRefusalCode.DuplicateRelation,
] as const;

export function readCommandRefusal(value: unknown): CommandRefusal {
	const reason = wireObject(value);
	const plain = PLAIN_COMMAND_REFUSAL_CODES.find((candidate) => candidate === reason['code']);
	if (plain !== undefined) {
		wireKeys(reason, ['code']);
		return { code: plain };
	}
	const code = DETAILED_COMMAND_REFUSAL_CODES.find((candidate) => candidate === reason['code']);
	if (code === undefined) throw new Error('Unknown command refusal code');
	switch (code) {
		case CommandRefusalCode.InvalidDocument:
			wireKeys(reason, ['code', 'details']);
			return { code, details: wireStrings(reason['details']) };
		case CommandRefusalCode.ElementMissing:
			wireKeys(reason, ['code', 'target']);
			return { code, target: readSharedTarget(reason['target']) };
		case CommandRefusalCode.InvalidLaneId:
			wireKeys(reason, ['code', 'laneId']);
			return { code, laneId: wireId(reason['laneId']) };
		case CommandRefusalCode.UnknownDestinationLane:
			wireKeys(reason, ['code', 'target']);
			return { code, target: wireString(reason['target']) };
		case CommandRefusalCode.GroupMissing:
			wireKeys(reason, ['code', 'groupId']);
			return { code, groupId: wireId(reason['groupId']) };
		case CommandRefusalCode.DuplicateRelationId:
			wireKeys(reason, ['code', 'relationId']);
			return { code, relationId: wireId(reason['relationId']) };
		case CommandRefusalCode.DuplicateRelation:
			wireKeys(reason, ['code', 'from', 'to', 'relationId']);
			return {
				code,
				from: wireId(reason['from']),
				to: wireId(reason['to']),
				relationId: wireId(reason['relationId']),
			};
		default: {
			const unhandled: never = code;
			throw new Error(`Unknown command refusal code: ${String(unhandled)}`);
		}
	}
}

export function readSessionRejection(value: unknown): SessionRejection {
	const reason = wireObject(value);
	const code = Object.values(SessionFailureCode).find((candidate) => candidate === reason['code']);
	if (code === undefined) throw new Error('Unknown session failure code');
	switch (code) {
		case SessionFailureCode.InvalidMessage:
		case SessionFailureCode.InvalidDocument:
			wireKeys(reason, ['code', 'details']);
			return { code, details: wireStrings(reason['details']) };
		case SessionFailureCode.StorageUnavailable:
		case SessionFailureCode.CommandGap:
		case SessionFailureCode.RepeatedCommandRefusal:
			wireKeys(reason, ['code']);
			return { code };
		case SessionFailureCode.CorruptCommandReceipt:
			wireKeys(reason, ['code', 'sessionId']);
			return { code, sessionId: wireId(reason['sessionId']) };
		default: {
			const unhandled: never = code;
			throw new Error(`Unknown session failure code: ${String(unhandled)}`);
		}
	}
}

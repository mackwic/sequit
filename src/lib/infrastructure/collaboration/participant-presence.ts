import type { SharedTarget } from '../document/shared-document-command';
import { readSharedTarget } from './shared-command-codec';
import { wireBytes, wireInteger, wireKeys, wireObject, wireString } from './wire-values';

// Bounds keep one attachment below 6 KiB and a 50-person room below the frame limit.
const MAX_PRESENCE_SELECTIONS = 16;
export const MAX_PRESENCE_PARTICIPANTS = 128;

export class InvalidPresenceError extends Error {}

export interface PresencePoint {
	readonly x: number;
	readonly y: number;
}

export interface TextSelectionPresence {
	readonly target: SharedTarget;
	readonly field: string;
	readonly anchor: Uint8Array;
	readonly head: Uint8Array;
}

export interface LocalPresence {
	readonly name: string;
	readonly color: string;
	readonly selected: readonly SharedTarget[];
	readonly pointer?: PresencePoint | null;
	readonly textSelection?: TextSelectionPresence | null;
}

export interface ParticipantPresence extends LocalPresence {
	readonly clientId: number;
}

function coordinate(value: unknown): number {
	if (typeof value !== 'number') throw new Error('Invalid pointer coordinate');
	if (!Number.isFinite(value) || Math.abs(value) > 10_000_000)
		throw new Error('Invalid pointer coordinate');
	return value;
}

function readPointer(value: unknown): PresencePoint | null {
	if (value === null) return null;
	const point = wireObject(value);
	wireKeys(point, ['x', 'y']);
	return { x: coordinate(point['x']), y: coordinate(point['y']) };
}

function position(value: unknown): Uint8Array {
	const bytes = wireBytes(value);
	if (bytes.length === 0 || bytes.length > 512) throw new Error('Invalid relative position size');
	return bytes;
}

function readTextSelection(value: unknown): TextSelectionPresence | null {
	if (value === null) return null;
	const selection = wireObject(value);
	wireKeys(selection, ['target', 'field', 'anchor', 'head']);
	const field = wireString(selection['field']);
	if (!['markdown', 'description', 'title', 'label'].includes(field))
		throw new Error('Invalid text selection field');
	return {
		target: readSharedTarget(selection['target']),
		field,
		anchor: position(selection['anchor']),
		head: position(selection['head']),
	};
}

export function readParticipantPresence(value: unknown): ParticipantPresence {
	const presence = wireObject(value);
	wireKeys(presence, ['clientId', 'name', 'color', 'selected', 'pointer', 'textSelection']);
	const selected: unknown = presence['selected'];
	if (!Array.isArray(selected)) throw new Error('Invalid selection');
	let result: ParticipantPresence = {
		clientId: wireInteger(presence['clientId']),
		name: wireString(presence['name']).slice(0, 128),
		color: wireString(presence['color']).slice(0, 64),
		selected: selected
			.slice(0, MAX_PRESENCE_SELECTIONS)
			.map((value: unknown) => readSharedTarget(value)),
	};
	if (presence['pointer'] !== undefined)
		result = { ...result, pointer: readPointer(presence['pointer']) };
	if (presence['textSelection'] !== undefined)
		result = { ...result, textSelection: readTextSelection(presence['textSelection']) };
	return result;
}

import {
	defined,
	LaneOrientation,
	LAYOUT_BIASES,
	LAYOUT_DIRECTIONS,
	layoutConfiguration,
	type LayoutLane,
} from '../../core/document/logic-document';
import { parseOrderKey } from '../../core/document/order-key';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	type SharedRootLanes,
	type SharedTarget,
} from '../document/shared-document-command';
import { readElementCreation, readElementUpdate } from './shared-element-codec';
import {
	wireId,
	wireKeys,
	wireObject,
	wireProperties,
	wireString,
	wireStrings,
} from './wire-values';

export function readSharedTarget(value: unknown): SharedTarget {
	const target = wireObject(value);
	wireKeys(target, ['kind', 'id']);
	const kind = defined(
		Object.values(SharedElementKind).find((kind) => kind === target['kind']),
		'Unknown element kind',
	);
	return { kind, id: wireId(target['id']) };
}

function readLane(value: unknown): LayoutLane {
	const lane = wireObject(value);
	wireKeys(lane, ['id', 'label', 'layoutOrder']);
	return {
		id: wireId(lane['id']),
		label: wireString(lane['label']),
		layoutOrder: defined(parseOrderKey(wireString(lane['layoutOrder'])), 'Invalid lane order'),
	};
}

function readRootLanes(value: unknown): SharedRootLanes {
	const lanes = wireObject(value);
	wireKeys(lanes, ['laneOrientation', 'lanes']);
	const entries = lanes['lanes'];
	if (!Array.isArray(entries)) throw new Error('Expected an array');
	return {
		laneOrientation: defined(
			Object.values(LaneOrientation).find((item) => item === lanes['laneOrientation']),
			'Unknown lane orientation',
		),
		lanes: entries.map(readLane),
	};
}

function readLayoutUpdate(command: Record<string, unknown>): SharedDocumentCommand {
	wireKeys(command, ['op', 'layout']);
	const layout = wireObject(command['layout']);
	wireKeys(layout, ['direction', 'bias']);
	const direction = defined(LAYOUT_DIRECTIONS.find((item) => item === layout['direction']));
	const bias = defined(LAYOUT_BIASES.find((item) => item === layout['bias']));
	return {
		op: SharedCommandKind.UpdateLayout,
		layout: defined(layoutConfiguration(direction, bias), 'Incompatible layout direction and bias'),
	};
}

function readLanesUpdate(command: Record<string, unknown>): SharedDocumentCommand {
	wireKeys(command, ['op', 'lanes', 'transfers']);
	const result: {
		op: SharedCommandKind.UpdateLanes;
		lanes?: SharedRootLanes;
		transfers?: Record<string, string>;
	} = { op: SharedCommandKind.UpdateLanes };
	if (command['lanes'] !== undefined) result.lanes = readRootLanes(command['lanes']);
	if (command['transfers'] !== undefined) result.transfers = wireProperties(command['transfers']);
	return result;
}

export function readSharedCommand(value: unknown): SharedDocumentCommand {
	const command = wireObject(value);
	switch (command['op']) {
		case SharedCommandKind.Create:
			wireKeys(command, ['op', 'target', 'properties']);
			return readElementCreation(
				readSharedTarget(command['target']),
				wireProperties(command['properties']),
			);
		case SharedCommandKind.Update:
			wireKeys(command, ['op', 'target', 'set', 'unset']);
			return readElementUpdate(
				readSharedTarget(command['target']),
				wireProperties(command['set']),
				wireStrings(command['unset']),
			);
		case SharedCommandKind.Delete: {
			wireKeys(command, ['op', 'target', 'replacementId']);
			const target = readSharedTarget(command['target']);
			if (target.kind === SharedElementKind.Document || target.kind === SharedElementKind.Group)
				throw new Error('Use ungroup to dissolve a group; the document cannot be deleted');
			if (target.kind === SharedElementKind.Nature) {
				const nature = {
					op: SharedCommandKind.Delete,
					target: { ...target, kind: SharedElementKind.Nature },
				} as const;
				if (command['replacementId'] === undefined) return nature;
				return { ...nature, replacementId: wireId(command['replacementId']) };
			}
			const deletion = {
				op: SharedCommandKind.Delete,
				target: { ...target, kind: target.kind },
			} as const;
			if (command['replacementId'] === undefined) return deletion;
			throw new Error('Only nature deletion accepts a replacement');
		}
		case SharedCommandKind.Group:
			wireKeys(command, ['op', 'id', 'label', 'members']);
			return {
				op: SharedCommandKind.Group,
				id: wireId(command['id']),
				label: wireString(command['label']),
				members: wireStrings(command['members']),
			};
		case SharedCommandKind.Ungroup:
			wireKeys(command, ['op', 'id']);
			return { op: SharedCommandKind.Ungroup, id: wireId(command['id']) };
		case SharedCommandKind.Move: {
			wireKeys(command, ['op', 'ids', 'groupId']);
			const ids = wireStrings(command['ids']).map(wireId);
			if (ids.length === 0) throw new Error('Select elements to move');
			if (command['groupId'] === undefined) return { op: SharedCommandKind.Move, ids };
			return { op: SharedCommandKind.Move, ids, groupId: wireId(command['groupId']) };
		}
		case SharedCommandKind.DeleteRelations: {
			wireKeys(command, ['op', 'ids']);
			const ids = wireStrings(command['ids']).map(wireId);
			if (ids.length === 0) throw new Error('Select relations to delete');
			return { op: SharedCommandKind.DeleteRelations, ids };
		}
		case SharedCommandKind.UpdateLayout:
			return readLayoutUpdate(command);
		case SharedCommandKind.UpdateLanes:
			return readLanesUpdate(command);
		default:
			throw new Error('Unknown document operation');
	}
}

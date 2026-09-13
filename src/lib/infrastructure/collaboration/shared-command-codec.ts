import {
	defined,
	LAYOUT_BIASES,
	LAYOUT_DIRECTIONS,
	layoutConfiguration,
} from '../../core/document/logic-document';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	type SharedTarget,
} from '../document/shared-document-command';
import {
	wireId,
	wireKeys,
	wireObject,
	wireProperties,
	wireString,
	wireStrings,
} from './wire-values';

function readTarget(value: unknown): SharedTarget {
	const target = wireObject(value);
	wireKeys(target, ['kind', 'id']);
	const kind = defined(
		Object.values(SharedElementKind).find((kind) => kind === target['kind']),
		'Unknown element kind',
	);
	return { kind, id: wireId(target['id']) };
}

export function readSharedCommand(value: unknown): SharedDocumentCommand {
	const command = wireObject(value);
	switch (command['op']) {
		case SharedCommandKind.Create:
			wireKeys(command, ['op', 'target', 'properties']);
			return {
				op: SharedCommandKind.Create,
				target: readTarget(command['target']),
				properties: wireProperties(command['properties']),
			};
		case SharedCommandKind.Update:
			wireKeys(command, ['op', 'target', 'set', 'unset']);
			return {
				op: SharedCommandKind.Update,
				target: readTarget(command['target']),
				set: wireProperties(command['set']),
				unset: wireStrings(command['unset']),
			};
		case SharedCommandKind.Delete: {
			wireKeys(command, ['op', 'target', 'replacementId']);
			const deletion = {
				op: SharedCommandKind.Delete,
				target: readTarget(command['target']),
			} as const;
			if (command['replacementId'] === undefined) return deletion;
			return { ...deletion, replacementId: wireId(command['replacementId']) };
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
		case SharedCommandKind.UpdateLayout: {
			wireKeys(command, ['op', 'layout']);
			const layout = wireObject(command['layout']);
			wireKeys(layout, ['direction', 'bias']);
			const direction = defined(LAYOUT_DIRECTIONS.find((item) => item === layout['direction']));
			const bias = defined(LAYOUT_BIASES.find((item) => item === layout['bias']));
			return {
				op: SharedCommandKind.UpdateLayout,
				layout: defined(
					layoutConfiguration(direction, bias),
					'Incompatible layout direction and bias',
				),
			};
		}
		default:
			throw new Error('Unknown document operation');
	}
}

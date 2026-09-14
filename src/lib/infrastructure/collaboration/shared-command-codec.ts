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
		case SharedCommandKind.DeleteRelations: {
			wireKeys(command, ['op', 'ids']);
			const ids = wireStrings(command['ids']).map(wireId);
			if (ids.length === 0) throw new Error('Select relations to delete');
			return { op: SharedCommandKind.DeleteRelations, ids };
		}
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

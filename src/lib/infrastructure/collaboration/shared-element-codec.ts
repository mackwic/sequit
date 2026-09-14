import { defined, GroupState, JUNCTION_OPERATORS } from '../../core/document/logic-document';
import {
	type CreateElement,
	SharedCommandKind as Op,
	SharedElementKind as Kind,
	SharedProperty,
	type SharedTarget,
	type UpdateElement,
} from '../document/shared-document-command';
import { assertSharedProperties } from './shared-element';
import { isSharedTextField } from './shared-text';
import { wireId, wireString } from './wire-values';

function checkEnums(properties: Readonly<Record<string, string>>): void {
	if (properties['state'] !== undefined)
		defined(
			Object.values(GroupState).find((value) => value === properties['state']),
			'Unknown group state',
		);
	if (properties['operator'] !== undefined)
		defined(
			JUNCTION_OPERATORS.find((value) => value === properties['operator']),
			'Unknown junction operator',
		);
	if (properties[SharedProperty.GroupId] !== undefined) wireId(properties[SharedProperty.GroupId]);
}

export function readElementCreation(
	target: SharedTarget,
	properties: Record<string, string>,
): CreateElement {
	assertSharedProperties(target.kind, properties);
	checkEnums(properties);
	const op = Op.Create;
	switch (target.kind) {
		case Kind.Node:
			return {
				op,
				target: { ...target, kind: Kind.Node },
				properties: {
					...properties,
					natureId: wireId(properties['natureId']),
					markdown: wireString(properties['markdown']),
				},
			};
		case Kind.Group:
			return {
				op,
				target: { ...target, kind: Kind.Group },
				properties: { ...properties, label: wireString(properties['label']) },
			};
		case Kind.Nature:
			return {
				op,
				target: { ...target, kind: Kind.Nature },
				properties: {
					...properties,
					label: wireString(properties['label']),
					color: wireString(properties['color']),
				},
			};
		case Kind.Junction:
			return {
				op,
				target: { ...target, kind: Kind.Junction },
				properties: {
					...properties,
					operator: defined(
						JUNCTION_OPERATORS.find((value) => value === properties['operator']),
						'Unknown junction operator',
					),
				},
			};
		case Kind.Relation:
			return {
				op,
				target: { ...target, kind: Kind.Relation },
				properties: { from: wireId(properties['from']), to: wireId(properties['to']) },
			};
		case Kind.Document:
		default:
			throw new Error('Use initialize to create the document');
	}
}

function optionalKeys<K extends string>(
	unset: readonly string[],
	allowed: readonly K[],
): readonly K[] {
	return unset.map((key) =>
		defined(
			allowed.find((value) => value === key),
			'Cannot unset a required property',
		),
	);
}

export function readElementUpdate(
	target: SharedTarget,
	set: Record<string, string>,
	unset: readonly string[],
): UpdateElement {
	assertSharedProperties(target.kind, set);
	checkEnums(set);
	if ([...Object.keys(set), ...unset].some(isSharedTextField))
		throw new Error('Use a Yjs update to edit text');
	const op = Op.Update;
	switch (target.kind) {
		case Kind.Node:
			return {
				op,
				target: { ...target, kind: Kind.Node },
				set,
				unset: optionalKeys(unset, [
					SharedProperty.GroupId,
					SharedProperty.Color,
					SharedProperty.Icon,
				]),
			};
		case Kind.Group:
			return {
				op,
				target: { ...target, kind: Kind.Group },
				set,
				unset: optionalKeys(unset, [SharedProperty.GroupId, SharedProperty.State]),
			};
		case Kind.Nature:
			return {
				op,
				target: { ...target, kind: Kind.Nature },
				set,
				unset: optionalKeys(unset, [SharedProperty.Icon]),
			};
		case Kind.Junction:
			return {
				op,
				target: { ...target, kind: Kind.Junction },
				set,
				unset: optionalKeys(unset, [SharedProperty.GroupId]),
			};
		case Kind.Relation:
			return {
				op,
				target: { ...target, kind: Kind.Relation },
				set,
				unset: optionalKeys(unset, []),
			};
		case Kind.Document:
		default:
			throw new Error('Use text or layout operations to update the document');
	}
}

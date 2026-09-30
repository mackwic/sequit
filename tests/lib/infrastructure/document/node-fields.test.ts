import { expect, it } from 'vitest';

import {
	newNodeFrom,
	type NodeFields,
	nodeFields,
	nodeUpdate,
} from '../../../../src/lib/infrastructure/document/node-fields';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';

it('builds node updates only for changed non-text properties', () => {
	const before: NodeFields = {
		natureId: 'goal',
		markdown: 'Original',
		description: '',
		color: '#112233',
		icon: 'phosphor:flag',
	};

	expect(nodeUpdate('N1', before, before)).toBeUndefined();
	expect(nodeUpdate('N1', before, { ...before, natureId: 'action' })).toEqual({
		op: Op.Update,
		target: { kind: Kind.Node, id: 'N1' },
		set: { natureId: 'action' },
		unset: [],
	});
	expect(nodeUpdate('N1', before, { ...before, color: '' })).toEqual({
		op: Op.Update,
		target: { kind: Kind.Node, id: 'N1' },
		set: {},
		unset: ['color'],
	});
	expect(nodeUpdate('N1', before, { ...before, description: 'Details' })).toBeUndefined();
	expect(nodeUpdate('N1', before, { ...before, markdown: 'Rewritten' })).toBeUndefined();
});

it('creates nodes without empty optional fields and preserves group membership', () => {
	const fields: NodeFields = {
		natureId: 'goal',
		markdown: 'Content',
		description: '',
		color: '',
		icon: '',
	};

	expect(newNodeFrom('N1', fields, 'group')).toEqual({
		id: 'N1',
		natureId: 'goal',
		markdown: 'Content',
		groupId: 'group',
	});
	expect(
		newNodeFrom('N2', { ...fields, description: 'Details', color: '#123456', icon: 'icon' }),
	).toEqual({
		id: 'N2',
		natureId: 'goal',
		markdown: 'Content',
		description: 'Details',
		color: '#123456',
		icon: 'icon',
	});
});

it('reads a node into fields and back without losing optional values', () => {
	const node = {
		natureId: 'goal',
		markdown: 'Content',
		description: 'Details',
		color: '#123456',
		icon: 'phosphor:flag',
	};
	expect(newNodeFrom('N', nodeFields(node))).toEqual({ id: 'N', ...node });
	expect(nodeFields({ natureId: 'goal', markdown: 'Content' })).toEqual({
		natureId: 'goal',
		markdown: 'Content',
		description: '',
		color: '',
		icon: '',
	});
});

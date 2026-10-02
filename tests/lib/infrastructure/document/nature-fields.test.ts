import { expect, it } from 'vitest';
import * as Y from 'yjs';

import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { CommandRefusalCode } from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	natureCreation,
	natureDeletion,
	natureEditing,
	NatureEditingMode,
	natureFields,
	natureRemoval,
	NatureRemovalKind,
	natureStyleUpdate,
	natureUsage,
	newNatureEditing,
} from '../../../../src/lib/infrastructure/document/nature-fields';
import {
	SharedCommandKind as Op,
	type SharedDocumentCommand,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

/** A and B use N; D is declared but unused. */
function document(): LogicDocument {
	const model = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'nature-fields');
	return {
		...model,
		natures: [...model.natures, { id: 'D', label: 'Décision', color: '#aabbcc', icon: 'none' }],
	};
}

function execute(model: LogicDocument, commands: readonly SharedDocumentCommand[]): LogicDocument {
	const doc = new Y.Doc();
	try {
		importLogicDocument(doc, model);
		return executeSharedCommands(doc, commands);
	} finally {
		doc.destroy();
	}
}

it('creates a nature with a trimmed label and no icon field when none is chosen', () => {
	const created = execute(document(), [
		natureCreation('F', { label: '  Fait ', color: '#aabbcc', icon: '' }),
		natureCreation('E', { label: 'Effet', color: '#112233', icon: 'phosphor:sparkle' }),
	]);
	expect(created.natures.find(({ id }) => id === 'F')).toEqual({
		id: 'F',
		label: 'Fait',
		color: '#aabbcc',
	});
	expect(created.natures.find(({ id }) => id === 'E')?.icon).toBe('phosphor:sparkle');
});

it('edits an explicitly hidden icon as no icon, and updates only the changed style', () => {
	expect(natureFields({ id: 'D', label: 'D', color: '#000000', icon: 'none' })).toEqual({
		label: 'D',
		color: '#000000',
		icon: '',
	});
	const base = { label: 'N', color: '#000000', icon: '' };
	expect(natureStyleUpdate('N', base, base)).toBeUndefined();
	expect(natureStyleUpdate('N', base, { ...base, label: 'Renamed' })).toBeUndefined();
	expect(natureStyleUpdate('N', base, { ...base, icon: 'phosphor:flag' })).toEqual({
		op: Op.Update,
		target: { kind: Kind.Nature, id: 'N' },
		set: { icon: 'phosphor:flag' },
		unset: [],
	});

	const styled = natureStyleUpdate('N', base, { ...base, color: '#ff0000', icon: 'phosphor:flag' });
	if (styled === undefined) throw new Error('Expected a style update');
	const iconed = execute(document(), [styled]);
	expect(iconed.natures.find(({ id }) => id === 'N')).toMatchObject({
		color: '#ff0000',
		icon: 'phosphor:flag',
	});
	const clearing = natureStyleUpdate('N', { ...base, icon: 'phosphor:flag' }, base);
	if (clearing === undefined) throw new Error('Expected the icon cleared');
	expect(execute(iconed, [clearing]).natures.find(({ id }) => id === 'N')).not.toHaveProperty(
		'icon',
	);
});

it('moves the boxes of a deleted nature to the replacement and refuses a used nature without one', () => {
	const model = document();
	expect(() => execute(model, [natureDeletion('N', undefined)])).toThrow(
		expect.objectContaining({
			reason: { code: CommandRefusalCode.NatureReplacementRequired },
		}),
	);
	const reassigned = execute(model, [natureDeletion('N', 'D')]);
	expect(reassigned.natures.map(({ id }) => id)).toEqual(['D']);
	expect(reassigned.nodes.every(({ natureId }) => natureId === 'D')).toBe(true);
	expect(execute(model, [natureDeletion('D', undefined)]).natures.map(({ id }) => id)).toEqual([
		'N',
	]);
});

it('counts boxes per nature, including zero for unused natures', () => {
	expect([...natureUsage(document())]).toEqual([
		['N', 2],
		['D', 0],
	]);
});

it('frees an unused nature, asks a replacement among the others, and blocks the last used one', () => {
	const model = document();
	const usage = natureUsage(model);
	expect(natureRemoval(model.natures, usage, 'D')).toEqual({ kind: NatureRemovalKind.Free });
	const reassign = natureRemoval(model.natures, usage, 'N');
	if (reassign.kind !== NatureRemovalKind.Reassign) throw new Error('Expected candidates');
	expect(reassign.candidates.map(({ id }) => id)).toEqual(['D']);
	const alone = model.natures.filter(({ id }) => id === 'N');
	expect(natureRemoval(alone, usage, 'N')).toEqual({ kind: NatureRemovalKind.Blocked });
});

it('opens an existing nature with its fields as base and draft, and a new one blank', () => {
	const [nature] = document().natures;
	if (nature === undefined) throw new Error('Expected the fixture nature');
	const editing = natureEditing(nature);
	expect(editing).toMatchObject({ id: 'N', mode: NatureEditingMode.Edit });
	expect(editing.draft).toEqual(editing.base);
	expect(editing.draft.label).toBe(nature.label);
	const fresh = newNatureEditing('fresh');
	expect(fresh).toMatchObject({ id: 'fresh', mode: NatureEditingMode.Create });
	expect(fresh.draft).toEqual({ label: '', color: '#6f70e8', icon: '' });
});

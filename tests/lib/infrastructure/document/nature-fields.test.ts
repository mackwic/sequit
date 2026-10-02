import { expect, it } from 'vitest';
import * as Y from 'yjs';

import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import {
	NATURE_FAMILIES,
	type NatureFamily,
	NatureFamilyId,
} from '../../../../src/lib/core/document/nature-families';
import { CommandRefusalCode } from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	natureAfterRemoval,
	natureCreation,
	natureDeletion,
	natureDraftChanged,
	natureEditing,
	NatureEditingMode,
	natureFamilyImport,
	natureFields,
	natureRemoval,
	NatureRemovalKind,
	natureUpdate,
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

it('creates a nature with a trimmed label, and no icon or family field when none is chosen', () => {
	const created = execute(document(), [
		natureCreation('F', { label: '  Fait ', color: '#aabbcc', icon: '', family: '' }),
		natureCreation('E', {
			label: 'Effet',
			color: '#112233',
			icon: 'phosphor:sparkle',
			family: 'goal-tree',
		}),
	]);
	expect(created.natures.find(({ id }) => id === 'F')).toEqual({
		id: 'F',
		label: 'Fait',
		color: '#aabbcc',
	});
	expect(created.natures.find(({ id }) => id === 'E')).toMatchObject({
		icon: 'phosphor:sparkle',
		family: 'goal-tree',
	});
});

it('edits an explicitly hidden icon as no icon, and updates only the changed fields', () => {
	expect(natureFields({ id: 'D', label: 'D', color: '#000000', icon: 'none' })).toEqual({
		label: 'D',
		color: '#000000',
		icon: '',
		family: '',
	});
	const base = { label: 'N', color: '#000000', icon: '', family: '' };
	expect(natureUpdate('N', base, base)).toBeUndefined();
	expect(natureUpdate('N', base, { ...base, label: 'Renamed' })).toBeUndefined();
	expect(natureUpdate('N', base, { ...base, icon: 'phosphor:flag' })).toEqual({
		op: Op.Update,
		target: { kind: Kind.Nature, id: 'N' },
		set: { icon: 'phosphor:flag' },
		unset: [],
	});

	const after = { ...base, color: '#ff0000', icon: 'phosphor:flag', family: 'generic' };
	const styled = natureUpdate('N', base, after);
	if (styled === undefined) throw new Error('Expected an update');
	const updated = execute(document(), [styled]);
	expect(updated.natures.find(({ id }) => id === 'N')).toMatchObject({
		color: '#ff0000',
		icon: 'phosphor:flag',
		family: 'generic',
	});
	const clearing = natureUpdate('N', after, { ...after, icon: '', family: '' });
	if (clearing === undefined) throw new Error('Expected the icon and family cleared');
	const cleared = execute(updated, [clearing]).natures.find(({ id }) => id === 'N');
	expect(cleared).not.toHaveProperty('icon');
	expect(cleared).not.toHaveProperty('family');
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
	expect(fresh.draft).toEqual({ label: '', color: '#6f70e8', icon: '', family: '' });
	expect(newNatureEditing('sibling', 'retro-kds').draft.family).toBe('retro-kds');
});

it('counts a draft as changed only when saving would change the nature', () => {
	const editing = natureEditing({ id: 'N', label: 'Need', color: '#000000' });
	const draft = (patch: Partial<typeof editing.draft>) => ({
		...editing,
		draft: { ...editing.draft, ...patch },
	});
	expect(natureDraftChanged(editing)).toBe(false);
	expect(natureDraftChanged(draft({ label: ' Need  ' }))).toBe(false);
	expect(natureDraftChanged(draft({ label: 'Needs' }))).toBe(true);
	expect(natureDraftChanged(draft({ color: '#ffffff' }))).toBe(true);
	expect(natureDraftChanged(draft({ icon: 'phosphor:flag' }))).toBe(true);
	expect(natureDraftChanged(draft({ family: 'generic' }))).toBe(true);
	expect(natureDraftChanged(newNatureEditing('fresh', 'generic'))).toBe(false);
});

it('shows the replacement after a removal, otherwise the first nature left', () => {
	const natures = [
		{ id: 'A', label: 'A', color: '#000000' },
		{ id: 'B', label: 'B', color: '#000000' },
		{ id: 'C', label: 'C', color: '#000000' },
	];
	expect(natureAfterRemoval(natures, 'A', 'C')?.id).toBe('C');
	expect(natureAfterRemoval(natures, 'A', undefined)?.id).toBe('B');
	expect(natureAfterRemoval(natures, 'B', 'B')?.id).toBe('A');
	expect(natureAfterRemoval(natures.slice(0, 1), 'A', undefined)).toBeUndefined();
});

function family(id: NatureFamilyId): NatureFamily {
	const found = NATURE_FAMILIES.find((candidate) => candidate.id === id);
	if (found === undefined) throw new Error(`Expected the ${id} family`);
	return found;
}

it('adds the family natures a library lacks and files in it those it holds without a family', () => {
	const generic = family(NatureFamilyId.Generic);
	const model = {
		...document(),
		natures: [
			...document().natures,
			{ id: 'problem', label: 'Mon problème', color: '#000000' },
			{ id: 'idea', label: 'Idée', color: '#000000', family: 'retro-kds' },
		],
	};
	const imported = execute(model, natureFamilyImport(model.natures, generic));
	expect(imported.natures.map(({ id }) => id).sort()).toEqual(
		['N', 'D', 'problem', 'idea', 'node', 'comment', 'question'].sort(),
	);
	expect(imported.natures.find(({ id }) => id === 'node')).toEqual({
		id: 'node',
		label: 'Node',
		color: '#64748b',
		family: 'generic',
	});
	expect(imported.natures.find(({ id }) => id === 'problem')).toEqual({
		id: 'problem',
		label: 'Mon problème',
		color: '#000000',
		family: 'generic',
	});
	expect(imported.natures.find(({ id }) => id === 'idea')?.family).toBe('retro-kds');
	expect(natureFamilyImport(imported.natures, generic)).toEqual([]);
});

it('gives each family its own « Question » when both are added', () => {
	const generic = execute(
		document(),
		natureFamilyImport(document().natures, family(NatureFamilyId.Generic)),
	);
	const both = execute(
		generic,
		natureFamilyImport(generic.natures, family(NatureFamilyId.RetroKds)),
	);
	expect(
		both.natures.filter(({ label }) => label === 'Question').map(({ family: id }) => id),
	).toEqual(expect.arrayContaining([NatureFamilyId.Generic, NatureFamilyId.RetroKds]));
	expect(both.natures.filter(({ label }) => label === 'Question')).toHaveLength(2);
});

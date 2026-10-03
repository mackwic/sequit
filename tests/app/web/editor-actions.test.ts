import { describe, expect, it } from 'vitest';

import { editorAction } from '../../../src/app/web/analytics/editor-actions';
import {
	connectedNodeCreation,
	containerMove,
	deletion,
	groupCreation,
	groupDissolution,
	groupFoldToggle,
	groupStyleUpdate,
	junctionInsertion,
	junctionOperatorUpdate,
	layoutUpdate,
	nodeNatureUpdate,
	relationCreation,
} from '../../../src/app/web/document/document-commands';
import { JunctionOperator } from '../../../src/lib/core/document/logic-document';
import { NATURE_FAMILIES } from '../../../src/lib/core/document/nature-families';
import {
	natureCreation,
	natureDeletion,
	natureFamilyImport,
	natureUpdate,
} from '../../../src/lib/infrastructure/document/nature-fields';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../support/fixtures/collaborative-document';

const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'actions');
const nature = { label: 'Risk', color: '#ff0000', icon: '', family: '' };
const box = { id: 'D', natureId: 'N', markdown: 'Delta' };
const group = model.groups[0];
if (group === undefined) throw new Error('The fixture has a group');

describe('editor actions counted from accepted batches', () => {
	it('tells a typed box, a linked typed box and a paste apart', () => {
		expect(editorAction(connectedNodeCreation(box, []))).toEqual({
			event: 'node_created',
			properties: { linked: false },
		});
		expect(editorAction(connectedNodeCreation(box, [{ id: 'AD', from: 'A', to: 'D' }]))).toEqual({
			event: 'node_created',
			properties: { linked: true },
		});
		expect(
			editorAction([
				...connectedNodeCreation(box, []),
				...connectedNodeCreation({ ...box, id: 'E' }, [{ id: 'DE', from: 'D', to: 'E' }]),
			]),
		).toEqual({ event: 'nodes_pasted', properties: { count: 2 } });
	});

	it('names batches by their main creation or removal, not by their relation bookkeeping', () => {
		expect(editorAction([relationCreation({ id: 'BA', from: 'B', to: 'A' })])).toEqual({
			event: 'nodes_linked',
		});
		const insertion = junctionInsertion(model, {
			junction: { id: 'J', operator: JunctionOperator.Xor },
			incoming: [{ id: 'AJ', from: 'A', to: 'J' }],
			outgoing: [{ id: 'JB', from: 'J', to: 'B' }],
			replacedRelationIds: ['R'],
		});
		expect(editorAction(insertion)).toEqual({ event: 'junction_inserted' });
		expect(editorAction(deletion(model, ['B'], ['R'], () => 'bridge'))).toEqual({
			event: 'selection_deleted',
			properties: { count: 2 },
		});
	});

	it('counts group, nature, layout and nature-assignment edits', () => {
		const fields = { label: group.label, color: '', laneId: '' };
		const cases = [
			[groupCreation('G2', ['A', 'B']), { event: 'group_created', properties: { count: 2 } }],
			[groupFoldToggle(group), { event: 'group_toggled' }],
			[
				groupStyleUpdate(group.id, fields, { ...fields, color: '#00ff00' }),
				{ event: 'group_edited' },
			],
			[groupDissolution(group.id), { event: 'group_dissolved' }],
			[containerMove(['A'], undefined), { event: 'elements_moved', properties: { count: 1 } }],
			[junctionOperatorUpdate('J', JunctionOperator.And), { event: 'junction_edited' }],
			[nodeNatureUpdate('A', 'N'), { event: 'node_nature_changed' }],
			[layoutUpdate(model.layout), { event: 'layout_changed' }],
			[natureCreation('N2', nature), { event: 'nature_created' }],
			[natureUpdate('N', nature, { ...nature, color: '#0000ff' }), { event: 'nature_edited' }],
			[natureDeletion('N', undefined), { event: 'nature_deleted' }],
		] as const;
		for (const [command, expected] of cases) {
			if (command === undefined) throw new Error(`No command for ${expected.event}`);
			expect(editorAction([command])).toEqual(expected);
		}
	});

	it('counts a family import by the natures it adds, and nothing for an empty batch', () => {
		const family = NATURE_FAMILIES[1];
		if (family === undefined) throw new Error('A second family exists');
		const commands = natureFamilyImport([], family);
		expect(editorAction(commands)).toEqual({
			event: 'natures_imported',
			properties: { count: commands.length },
		});
		expect(editorAction([])).toBeUndefined();
	});
});

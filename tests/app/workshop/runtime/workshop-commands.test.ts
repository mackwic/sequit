import fc from 'fast-check';
import { afterEach, expect, it } from 'vitest';
import type * as Y from 'yjs';

import source from '../../../../src/app/workshop/branching.toml?raw';
import { WorkshopDocument } from '../../../../src/app/workshop/runtime/workshop-document';
import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';

const stores: WorkshopDocument[] = [];
function open() {
	const store = new WorkshopDocument(source);
	stores.push(store);
	return store;
}
afterEach(() => {
	for (const store of stores) store.destroy();
	stores.length = 0;
});

it('reads current state for consecutive commands and keeps Y.Text identity and local history', async () => {
	const store = open();
	const node = store.ydoc.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('collecter');
	const text = node?.get('markdown');
	await store.opened.replaceNodeMarkdown('collecter', 'Texte récent');
	store.commands.renameDocument('Titre récent');
	store.commands.saveNature({ id: 'review', label: 'Revue', color: '#123456' });
	store.commands.assignNature('review', new Set(['collecter']));
	expect(store.read().title).toBe('Titre récent');
	expect(store.node('collecter')).toMatchObject({ natureId: 'review', markdown: 'Texte récent' });
	expect(store.node('comparer').natureId).toBe('action');
	expect(node?.get('markdown')).toBe(text);
	store.history.undo();
	expect(store.node('collecter').natureId).toBe('action');
	store.history.redo();
	expect(store.node('collecter').natureId).toBe('review');
});

it('reassigns a removed nature atomically while preserving node overrides and content', () => {
	const store = open();
	store.commands.styleNode('collecter', { color: '#123456', icon: 'none' });
	store.commands.styleNature('goal', { color: '#abcdef', icon: 'phosphor:flag' });
	const before = store.text();
	store.commands.removeNature('action', 'goal');
	expect(store.read().natures).toHaveLength(1);
	expect(store.read().nodes.every((node) => node.natureId === 'goal')).toBe(true);
	expect(store.node('collecter')).toMatchObject({ color: '#123456', icon: 'none' });
	expect(store.read().natures[0]).toMatchObject({ color: '#abcdef', icon: 'phosphor:flag' });
	store.history.undo();
	expect(store.text()).toBe(before);
	store.history.redo();
	expect(store.read().natures).toHaveLength(1);
});

it('updates an existing nature without duplicate ids, preserving unrelated natures', () => {
	const store = open();
	const goal = store.read().natures.find((nature) => nature.id === 'goal');
	store.commands.saveNature({ id: 'action', label: 'Faire', color: '#123', icon: 'none' });
	expect(store.read().natures).toHaveLength(2);
	expect(store.read().natures.find((nature) => nature.id === 'goal')).toEqual(goal);
	expect(store.read().natures.find((nature) => nature.id === 'action')).toEqual({
		id: 'action',
		label: 'Faire',
		color: '#123',
		icon: 'none',
	});
});

it('rejects invalid nature commands without changing the source or undo history', () => {
	const store = open();
	const before = store.text();
	for (const run of [
		() => {
			store.commands.removeNature('action', 'action');
		},
		() => {
			store.commands.removeNature('action', 'missing');
		},
		() => {
			store.commands.removeNature('missing', 'goal');
		},
		() => {
			store.commands.assignNature('missing', new Set(['collecter']));
		},
		() => {
			store.commands.saveNature({ id: 'action', label: 'Bad', color: 'red' });
		},
	])
		expect(run).toThrow();
	expect(store.text()).toBe(before);
	expect(store.history.canUndo()).toBe(false);
});

it('groups, renames, changes membership and dissolves without losing nodes', () => {
	const store = open();
	const nodes = store.read().nodes;
	store.commands.groupNodes({ id: 'g', label: 'G' }, new Set(['collecter']));
	store.commands.renameGroup('g', 'Sources');
	expect(store.read().groups[0]?.label).toBe('Sources');
	store.commands.changeMembership('g', new Set(['explorer']), true);
	expect(store.node('explorer').groupId).toBe('g');
	store.commands.dissolveGroup('g');
	expect(store.read().groups).toEqual([]);
	expect(store.read().nodes).toEqual(nodes);
	expect(() => {
		store.commands.renameGroup('missing', 'Missing');
	}).toThrow('Groupe introuvable');
});

it('creates, duplicates and removes nodes through atomic commands', () => {
	const store = open();
	store.commands.addNode(
		{ id: 'new', natureId: 'action', markdown: 'Suite' },
		{ id: 'new-link', from: 'comparer' },
	);
	store.commands.duplicateNodes([{ sourceId: 'new', id: 'copy' }]);
	expect(store.node('copy').markdown).toBe('Suite');
	store.commands.removeNodes(new Set(['new']));
	expect(store.read().relations.some((relation) => relation.to === 'new')).toBe(false);
	store.history.undo();
	expect(store.read().relations).toContainEqual({ id: 'new-link', from: 'comparer', to: 'new' });
	store.commands.placeNodeFirst('explorer');
	expect(store.node('explorer').layoutOrder < store.node('collecter').layoutOrder).toBe(true);
});

it('validates relation edits and keeps their undo atomic', async () => {
	const store = open();
	await store.commands.addRelation({ id: 'direct', from: 'collecter', to: 'decider' });
	store.commands.retargetRelation({ id: 'direct', from: 'explorer', to: 'decider' });
	expect(store.read().relations).toContainEqual({ id: 'direct', from: 'explorer', to: 'decider' });
	const before = store.text();
	expect(() => {
		store.commands.retargetRelation({ id: 'direct', from: 'decider', to: 'collecter' });
	}).toThrow();
	expect(() => {
		store.commands.retargetRelation({ id: 'missing', from: 'collecter', to: 'decider' });
	}).toThrow('Relation introuvable');
	expect(store.text()).toBe(before);
	store.commands.removeRelation('direct');
	expect(store.read().relations.some((relation) => relation.id === 'direct')).toBe(false);
	store.history.undo();
	expect(store.text()).toBe(before);
});

it('rewires a convergence in one step, preserves other relations and rejects repeated endpoints', () => {
	const store = open();
	const before = store.text();
	const convergence = { id: 'xor', first: 'collecter', second: 'explorer', target: 'comparer' };
	expect(() => {
		store.commands.createConvergence({ ...convergence, second: 'collecter' });
	}).toThrow('distinctes');
	store.commands.createConvergence(convergence);
	expect(store.read().junctions[0]?.id).toBe('xor');
	expect(store.read().relations).toHaveLength(4);
	expect(store.read().relations).toContainEqual({
		id: 'comparer-decider',
		from: 'comparer',
		to: 'decider',
	});
	expect(store.read().relations).toContainEqual({ id: 'xor-c', from: 'xor', to: 'comparer' });
	store.history.undo();
	expect(store.text()).toBe(before);
	expect(store.history.canUndo()).toBe(false);
});

it('arranges in either axis and creates an undoable empty document retaining its natures', () => {
	const store = open();
	store.commands.arrange(LayoutDirection.LeftToRight);
	expect(store.read().layout).toEqual({ direction: 'left-to-right', bias: 'left' });
	store.commands.arrange(LayoutDirection.BottomToTop);
	expect(store.read().layout).toEqual({ direction: 'bottom-to-top', bias: 'top' });
	const before = store.text();
	const natures = store.read().natures;
	store.commands.newDocument('new-id');
	expect(store.read()).toMatchObject({
		id: 'new-id',
		title: 'Sans titre',
		nodes: [],
		groups: [],
		relations: [],
		junctions: [],
		natures,
	});
	store.history.undo();
	expect(store.text()).toBe(before);
});

it('roundtrips arbitrary nature labels and restores their exact previous state', () => {
	fc.assert(
		fc.property(fc.string(), (label) => {
			const store = new WorkshopDocument(source);
			try {
				const before = store.text();
				store.commands.saveNature({ id: 'action', label, color: '#123456' });
				const parsed = parseSequitToml(store.text());
				expect(parsed.ok).toBe(true);
				if (parsed.ok)
					expect(parsed.value.natures.find((nature) => nature.id === 'action')?.label).toBe(label);
				store.history.undo();
				expect(store.text()).toBe(before);
			} finally {
				store.destroy();
			}
		}),
		{ numRuns: 30 },
	);
});

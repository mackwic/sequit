import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import * as opening from '../../../../src/app/web/projection/open-document';
import source from '../../../../src/app/workshop/branching.toml?raw';
import { WorkshopDocument } from '../../../../src/app/workshop/runtime/workshop-document';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
const stores: WorkshopDocument[] = [];
function open() {
	const value = new WorkshopDocument(source);
	stores.push(value);
	return value;
}
afterEach(() => {
	for (const store of stores) store.destroy();
	stores.length = 0;
	vi.restoreAllMocks();
});
describe('workshop document operations', () => {
	it('publishes experimental edits through the actual document session and preserves text identity', () => {
		const store = open();
		const before = store.read();
		const changed = vi.fn();
		const updates = vi.fn();
		store.ydoc.on('update', updates);
		const stop = store.opened.subscribe(changed);
		const map = defined(store.ydoc.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('collecter'));
		const text = map.get('markdown');
		expect(text).toBeInstanceOf(Y.Text);
		store.apply({
			...before,
			title: 'Après',
			nodes: before.nodes.map((node) => ({ ...node, markdown: `${node.markdown} !` })),
		});
		expect(changed).toHaveBeenCalledOnce();
		expect(store.read().title).toBe('Après');
		expect(
			store.opened.measurementModel.nodes.find((node) => node.id === 'collecter')?.markdown,
		).toContain(' !');
		expect(map.get('markdown')).toBe(text);
		store.apply(store.read());
		expect(updates).toHaveBeenCalledOnce();
		stop();
	});
	it('undoes and redoes both mature and experimental edits', async () => {
		const store = open();
		const original = store.text();
		await store.opened.replaceNodeMarkdown('comparer', 'Un autre contenu');
		expect(store.history.canUndo()).toBe(true);
		store.history.undo();
		expect(store.text()).toBe(original);
		store.history.redo();
		expect(store.node('comparer').markdown).toBe('Un autre contenu');
		store.apply({ ...store.read(), title: 'Titre modifié' });
		store.history.undo();
		expect(store.read().title).toBe('Préparer une décision');
		store.history.redo();
		expect(store.read().title).toBe('Titre modifié');
	});
	it('creates, groups, dissolves and removes entities in the same source', () => {
		const store = open();
		const model = store.read();
		store.apply({
			...model,
			groups: [{ id: 'group', kind: EndpointKind.Group, label: 'Branche', layoutOrder: 'b00' }],
			nodes: model.nodes.map((node) => ({ ...node, groupId: 'group' })),
			junctions: [
				{
					id: 'xor',
					kind: EndpointKind.Junction,
					operator: JunctionOperator.Xor,
					layoutOrder: 'b01',
					groupId: 'group',
				},
			],
			natures: [...model.natures, { id: 'new', label: 'Nouveau', color: '#123456' }],
		});
		expect(store.node('collecter').groupId).toBe('group');
		expect(store.read().junctions).toHaveLength(1);
		store.apply(model);
		expect(store.read()).toEqual(model);
		expect(store.node('collecter')).not.toHaveProperty('groupId');
		store.history.undo();
		expect(store.read().groups).toHaveLength(1);
	});
	it('imports a valid document and roundtrips metadata and layout', () => {
		const store = open();
		store.apply({
			...store.read(),
			id: 'other',
			title: 'Nouveau titre',
			layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		});
		const text = store.text();
		const imported = open();
		imported.import(text);
		expect(imported.read()).toEqual(store.read());
	});
	it('keeps the current document intact on malformed text, unknown nature or cyclic topology', () => {
		const store = open();
		const model = store.read();
		const original = store.text();
		expect(() => {
			store.import('[broken');
		}).toThrow();
		expect(() => {
			store.apply({ ...model, natures: [] });
		}).toThrow();
		expect(() => {
			store.apply({
				...model,
				relations: [...model.relations, { id: 'cycle', from: 'decider', to: 'collecter' }],
			});
		}).toThrow();
		expect(store.text()).toBe(original);
		expect(store.history.canUndo()).toBe(false);
	});
	it('rejects a malformed or cyclic initial source', () => {
		expect(() => new WorkshopDocument('bad')).toThrow();
		expect(
			() => new WorkshopDocument(`${source}\n[relations.cycle]\nfrom="decider"\nto="collecter"`),
		).toThrow();
	});
	it('reports source corruption and missing nodes instead of silently writing', () => {
		const store = open();
		expect(() => store.node('missing')).toThrow();
		store.ydoc.getMap(YjsCollection.Natures).clear();
		expect(() => store.read()).toThrow();
	});
	it('reports a document-session startup failure', () => {
		vi.spyOn(opening, 'openDocument').mockReturnValue({
			ok: false,
			diagnostics: [{ code: 'startup', message: 'Cannot open', path: [] }],
		});
		expect(() => new WorkshopDocument(source)).toThrow('Cannot open');
	});
	it('preserves arbitrary Markdown through import, serialization and undo', () => {
		fc.assert(
			fc.property(fc.string(), (markdown) => {
				const store = new WorkshopDocument(source);
				try {
					const before = store.text();
					store.apply({
						...store.read(),
						nodes: store.read().nodes.map((node) => ({ ...node, markdown })),
					});
					const parsed = parseSequitToml(store.text());
					expect(parsed.ok).toBe(true);
					if (parsed.ok)
						expect(parsed.value.nodes.every((node) => node.markdown === markdown)).toBe(true);
					store.history.undo();
					expect(store.text()).toBe(before);
				} finally {
					store.destroy();
				}
			}),
			{ numRuns: 40 },
		);
	});
});

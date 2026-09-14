import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { reconcileSharedDocument } from '../../../../src/lib/infrastructure/collaboration/reconcile-shared-document';
import { upgradeSharedTexts } from '../../../../src/lib/infrastructure/collaboration/upgrade-shared-texts';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

it('migrates an absent or scalar description to stable text and omits only its empty projection', () => {
	const source = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'description');
	const doc = new Y.Doc();
	importLogicDocument(doc, source);
	const nodes = doc.getMap<Y.Map<unknown>>('sequit.nodes');
	const a = nodes.get('A');
	const b = nodes.get('B');
	if (a === undefined || b === undefined) throw new Error('Expected nodes');
	a.delete('description');
	b.set('description', '**Details**');
	const legacy = readLogicDocument(doc);
	if (!legacy.ok) throw new Error('Expected legacy description');
	expect(legacy.value.nodes[0]).not.toHaveProperty('description');
	expect(legacy.value.nodes[1]?.description).toBe('**Details**');
	expect(upgradeSharedTexts(doc)).toBe(true);
	expect(upgradeSharedTexts(doc)).toBe(false);
	const description = a.get('description');
	if (!(description instanceof Y.Text)) throw new Error('Expected description text');
	description.insert(0, '### Détails\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
	const projected = readLogicDocument(doc);
	if (!projected.ok) throw new Error('Expected valid description');
	expect(projected.value.nodes[0]?.description).toBe(description.toJSON());
	reconcileSharedDocument(doc, projected.value, 'reconcile');
	expect(a.get('description')).toBe(description);
	description.delete(0, description.length);
	const empty = readLogicDocument(doc);
	if (!empty.ok) throw new Error('Expected empty description');
	expect(empty.value.nodes[0]).not.toHaveProperty('description');
	reconcileSharedDocument(doc, empty.value, 'reconcile');
	expect(a.get('description')).toBe(description);
	a.set('description', 42);
	expect(readLogicDocument(doc).ok).toBe(false);
	doc.destroy();
});

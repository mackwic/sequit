import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { upgradeSharedTexts } from '../../../../src/lib/infrastructure/collaboration/upgrade-shared-texts';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

it('upgrades scalar labels from existing snapshots once while retaining entity maps and content', () => {
	const document = new Y.Doc();
	const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'room');
	importLogicDocument(document, model);
	const meta = document.getMap(YjsCollection.Meta);
	meta.set('title', model.title);
	const group = document.getMap<Y.Map<unknown>>(YjsCollection.Groups).get('G');
	const nature = document.getMap<Y.Map<unknown>>(YjsCollection.Natures).get('N');
	group?.set('label', 'Groupe');
	nature?.set('label', 'Action');
	expect(upgradeSharedTexts(document)).toBe(true);
	expect(meta.get('title')).toBeInstanceOf(Y.Text);
	expect(group?.get('label')).toBeInstanceOf(Y.Text);
	expect(nature?.get('label')).toBeInstanceOf(Y.Text);
	expect(document.getMap(YjsCollection.Groups).get('G')).toBe(group);
	expect(readLogicDocument(document)).toMatchObject({ ok: true, value: model });
	expect(upgradeSharedTexts(document)).toBe(false);
	document.destroy();
});

import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { reconcileSharedDocument } from '../../../../src/lib/infrastructure/collaboration/reconcile-shared-document';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { validLogicDocument } from '../../../support/builders/logic-document';

function duplicatedRelations() {
	const source = validLogicDocument();
	return {
		...source,
		relations: [...source.relations, { id: 'a-to-choice', from: 'source-b', to: 'choice' }],
	};
}

it('refuses duplicate source relation IDs before a Yjs import mutates the document', () => {
	const document = new Y.Doc();
	expect(() => {
		importLogicDocument(document, duplicatedRelations());
	}).toThrow('Duplicate relation IDs');
	expect(document.getMap(YjsCollection.Meta).size).toBe(0);
	expect(document.getMap(YjsCollection.Relations).size).toBe(0);
	document.destroy();
});

it('refuses duplicate relation IDs before reconciling a valid live document', () => {
	const document = new Y.Doc();
	importLogicDocument(document, validLogicDocument());
	const before = readLogicDocument(document);
	expect(() => {
		reconcileSharedDocument(document, duplicatedRelations(), 'duplicate');
	}).toThrow('Duplicate relation IDs');
	expect(readLogicDocument(document)).toEqual(before);
	document.destroy();
});

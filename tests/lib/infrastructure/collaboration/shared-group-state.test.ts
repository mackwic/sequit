import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { GroupState } from '../../../../src/lib/core/document/logic-document';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import { validLogicDocument } from '../../../support/builders/logic-document';

describe('shared group state persistence', () => {
	it.each([undefined, GroupState.Expanded, GroupState.Closed])(
		'preserves %s through TOML and Yjs without deleting members',
		(state) => {
			const original = validLogicDocument();
			const document = {
				...original,
				groups: original.groups.map((group) => {
					if (state === undefined) return group;
					return { ...group, state };
				}),
			};
			const parsed = parseSequitToml(serializeSequitToml(document));
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) throw new Error('Invalid document');
			expect(parsed.value.groups.map((group) => group.state)).toEqual(
				document.groups.map((group) => group.state),
			);
			expect(parsed.value.nodes).toHaveLength(original.nodes.length);
			const ydoc = new Y.Doc();
			importLogicDocument(ydoc, parsed.value);
			const result = readLogicDocument(ydoc);
			expect(result).toEqual(parsed);
			ydoc.destroy();
		},
	);

	it('rejects unsupported group states from portable and shared documents', () => {
		const document = validLogicDocument();
		const source = serializeSequitToml(document).replace(
			'[groups.container]',
			'[groups.container]\nstate = "hidden"',
		);
		expect(parseSequitToml(source)).toMatchObject({ ok: false });
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, document);
		ydoc.getMap<Y.Map<unknown>>(YjsCollection.Groups).get('container')?.set('state', 'hidden');
		expect(readLogicDocument(ydoc)).toMatchObject({ ok: false });
		const corrupt = {
			...document,
			groups: document.groups.map((group) => Object.assign({}, group, { state: 'hidden' })),
		};
		// Model consumers can receive runtime values despite their static type contract.
		expect(validateLogicDocument(Object.assign({}, document, corrupt))).toMatchObject({
			ok: false,
		});
		ydoc.destroy();
	});
});

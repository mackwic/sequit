import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { remoteTextRanges } from '../../../../src/app/web/document/text-awareness';
import { SharedElementKind } from '../../../../src/lib/infrastructure/document/shared-document-command';

it('resolves peer selections against the current text after insertions and ignores other or malformed cursors', () => {
	const doc = new Y.Doc();
	const text = doc.getText('text');
	text.insert(0, 'Alpha');
	const position = (index: number): Uint8Array =>
		Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index));
	const identity = { clientId: 2, name: 'Bob', color: '#abcdef', selected: [] };
	const textSelection = {
		target: { kind: SharedElementKind.Node, id: 'A' },
		field: 'markdown',
		anchor: position(4),
		head: position(1),
	};
	text.insert(0, 'New ');
	expect(remoteTextRanges(text, [{ ...identity, textSelection }])).toEqual([
		{ clientId: 2, name: 'Bob', color: '#abcdef', anchor: 8, head: 5 },
	]);
	expect(remoteTextRanges(doc.getText('other'), [{ ...identity, textSelection }])).toEqual([]);
	expect(remoteTextRanges(new Y.Text(), [identity])).toEqual([]);
	expect(
		remoteTextRanges(text, [
			identity,
			{ ...identity, textSelection: null },
			{ ...identity, textSelection: { ...textSelection, anchor: new Uint8Array([255]) } },
		]),
	).toEqual([]);
	doc.destroy();
});

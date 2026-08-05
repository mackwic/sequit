import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
	replaceNodeMarkdown,
} from '../../src/lib/collaboration/yjs-live-document';
import type { LogicDocument } from '../../src/lib/document/logic-document';
import { acyclicLogicDocumentArbitrary, nodeId } from '../builders/logic-document-arbitrary';

function readableDocument(ydoc: Y.Doc): LogicDocument {
	const result = readLogicDocument(ydoc);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected a readable generated Yjs document');
	return result.value;
}

function replicaFrom(update: Uint8Array): Y.Doc {
	const replica = new Y.Doc();
	Y.applyUpdate(replica, update);
	return replica;
}

const convergenceCaseArbitrary = acyclicLogicDocumentArbitrary({ minNodes: 2, maxNodes: 12 }).chain(
	(document) =>
		fc
			.tuple(
				fc.integer({ min: 0, max: document.nodes.length - 1 }),
				fc.integer({ min: 0, max: document.nodes.length - 1 }),
				fc.string({ maxLength: 160, unit: 'grapheme' }),
				fc.string({ maxLength: 160, unit: 'grapheme' }),
			)
			.map(([firstNodeIndex, secondNodeIndex, firstMarkdown, secondMarkdown]) => ({
				document,
				firstNodeIndex,
				secondNodeIndex,
				firstMarkdown,
				secondMarkdown,
			})),
);

describe('generated Yjs live documents', () => {
	it('preserves every generated document through binary serialization and reading', () => {
		fc.assert(
			fc.property(acyclicLogicDocumentArbitrary(), (document) => {
				const origin = new Y.Doc();
				importLogicDocument(origin, document);
				const replica = replicaFrom(Y.encodeStateAsUpdate(origin));
				expect(readableDocument(replica)).toEqual(document);
			}),
			{ numRuns: 100 },
		);
	});

	it('converges two generated updates independently of their delivery order', () => {
		fc.assert(
			fc.property(convergenceCaseArbitrary, (generated) => {
				const origin = new Y.Doc();
				importLogicDocument(origin, generated.document);
				const baseline = Y.encodeStateAsUpdate(origin);
				const first = replicaFrom(baseline);
				const second = replicaFrom(baseline);
				const firstState = Y.encodeStateVector(first);
				const secondState = Y.encodeStateVector(second);

				expect(
					replaceNodeMarkdown(first, nodeId(generated.firstNodeIndex), generated.firstMarkdown),
				).toBe(true);
				expect(
					replaceNodeMarkdown(second, nodeId(generated.secondNodeIndex), generated.secondMarkdown),
				).toBe(true);
				const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
				const secondUpdate = Y.encodeStateAsUpdate(second, secondState);

				const firstThenSecond = replicaFrom(baseline);
				Y.applyUpdate(firstThenSecond, firstUpdate);
				Y.applyUpdate(firstThenSecond, secondUpdate);
				const secondThenFirst = replicaFrom(baseline);
				Y.applyUpdate(secondThenFirst, secondUpdate);
				Y.applyUpdate(secondThenFirst, firstUpdate);

				expect(readableDocument(secondThenFirst)).toEqual(readableDocument(firstThenSecond));
				expect(Y.encodeStateVector(secondThenFirst)).toEqual(Y.encodeStateVector(firstThenSecond));
			}),
			{ numRuns: 100 },
		);
	});
});

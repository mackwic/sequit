import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { attachDocumentSession } from '../../../../src/app/web/document/yjs-document-session';
import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { DocumentCommandOutcomeKind } from '../../../../src/lib/infrastructure/document/document-command-contracts';
import {
	nodeId,
	richAcyclicLogicDocumentArbitrary,
} from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

interface CollaborationCase {
	readonly document: LogicDocument;
	readonly nodeIndexes: readonly [number, number, number];
	readonly markdown: readonly [string, string, string, string, string, string];
}

function readableDocument(ydoc: Y.Doc): LogicDocument {
	const result = readLogicDocument(ydoc);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected a readable generated Yjs document');
	return result.value;
}

function canonicalDocument(document: LogicDocument): LogicDocument {
	const byId = <T extends { readonly id: string }>(entities: readonly T[]): readonly T[] =>
		[...entities].sort((left, right) => left.id.localeCompare(right.id));
	return {
		...document,
		natures: byId(document.natures),
		groups: byId(document.groups),
		nodes: byId(document.nodes),
		junctions: byId(document.junctions),
		relations: byId(document.relations),
	};
}

function replicaFrom(update: Uint8Array): Y.Doc {
	const replica = new Y.Doc();
	Y.applyUpdate(replica, update);
	return replica;
}

function baselineFor(document: LogicDocument): Uint8Array {
	const origin = new Y.Doc();
	importLogicDocument(origin, document);
	return Y.encodeStateAsUpdate(origin);
}

async function applyMarkdown(ydoc: Y.Doc, index: number, markdown: string): Promise<void> {
	const session = attachDocumentSession(ydoc);
	try {
		expect((await session.replaceNodeMarkdown(nodeId(index), markdown)).kind).toBe(
			DocumentCommandOutcomeKind.Accepted,
		);
	} finally {
		session.destroy();
	}
}

async function localUpdate(
	baseline: Uint8Array,
	operations: readonly (readonly [number, string])[],
): Promise<Uint8Array> {
	const replica = replicaFrom(baseline);
	const baselineState = Y.encodeStateVector(replica);
	for (const [index, markdown] of operations) await applyMarkdown(replica, index, markdown);
	return Y.encodeStateAsUpdate(replica, baselineState);
}

function replicaWithUpdates(baseline: Uint8Array, updates: readonly Uint8Array[]): Y.Doc {
	const replica = replicaFrom(baseline);
	for (const update of updates) Y.applyUpdate(replica, update);
	return replica;
}

function expectConverged(replicas: readonly Y.Doc[]): void {
	const first = replicas[0];
	if (!first) throw new Error('At least one replica is required');
	const expectedDocument = readableDocument(first);
	const expectedStateVector = Y.encodeStateVector(first);
	for (const replica of replicas.slice(1)) {
		expect(readableDocument(replica)).toEqual(expectedDocument);
		expect(Y.encodeStateVector(replica)).toEqual(expectedStateVector);
	}
}

const collaborationCaseArbitrary: fc.Arbitrary<CollaborationCase> =
	richAcyclicLogicDocumentArbitrary({ minNodes: 3, maxNodes: 12 }).chain((document) =>
		fc
			.tuple(
				fc.tuple(
					fc.integer({ min: 0, max: document.nodes.length - 1 }),
					fc.integer({ min: 0, max: document.nodes.length - 1 }),
					fc.integer({ min: 0, max: document.nodes.length - 1 }),
				),
				fc.tuple(
					fc.string({ maxLength: 160, unit: 'grapheme' }),
					fc.string({ maxLength: 160, unit: 'grapheme' }),
					fc.string({ maxLength: 160, unit: 'grapheme' }),
					fc.string({ maxLength: 160, unit: 'grapheme' }),
					fc.string({ maxLength: 160, unit: 'grapheme' }),
					fc.string({ maxLength: 160, unit: 'grapheme' }),
				),
			)
			.map(([nodeIndexes, markdown]) => ({ document, nodeIndexes, markdown })),
	);

const updateOrders: readonly (readonly [number, number, number])[] = [
	[0, 1, 2],
	[0, 2, 1],
	[1, 0, 2],
	[1, 2, 0],
	[2, 0, 1],
	[2, 1, 0],
];

function requiredAt<T>(values: readonly T[], index: number, description: string): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Missing ${description} at index ${index}`);
	return value;
}

describe('generated Yjs live documents', () => {
	it('preserves every generated rich document through binary serialization and reading', () => {
		fc.assert(
			fc.property(richAcyclicLogicDocumentArbitrary(), (document) => {
				const replica = replicaFrom(baselineFor(document));
				expect(readableDocument(replica)).toEqual(canonicalDocument(document));
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('converges two generated updates independently of their delivery order', async () => {
		await fc.assert(
			fc.asyncProperty(collaborationCaseArbitrary, async (generated) => {
				const baseline = baselineFor(generated.document);
				const firstUpdate = await localUpdate(baseline, [
					[generated.nodeIndexes[0], generated.markdown[0]],
				]);
				const secondUpdate = await localUpdate(baseline, [
					[generated.nodeIndexes[1], generated.markdown[1]],
				]);
				expectConverged([
					replicaWithUpdates(baseline, [firstUpdate, secondUpdate]),
					replicaWithUpdates(baseline, [secondUpdate, firstUpdate]),
				]);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('is idempotent when the same update is delivered twice', async () => {
		await fc.assert(
			fc.asyncProperty(collaborationCaseArbitrary, async (generated) => {
				const baseline = baselineFor(generated.document);
				const update = await localUpdate(baseline, [
					[generated.nodeIndexes[0], generated.markdown[0]],
				]);
				expectConverged([
					replicaWithUpdates(baseline, [update]),
					replicaWithUpdates(baseline, [update, update]),
				]);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('is associative and commutative for every delivery order of three updates', async () => {
		await fc.assert(
			fc.asyncProperty(collaborationCaseArbitrary, async (generated) => {
				const baseline = baselineFor(generated.document);
				const updates = await Promise.all(
					generated.nodeIndexes.map((index, updateIndex) =>
						localUpdate(baseline, [
							[index, requiredAt(generated.markdown, updateIndex, 'markdown')],
						]),
					),
				);
				const replicas = updateOrders.map((order) =>
					replicaWithUpdates(
						baseline,
						order.map((index) => requiredAt(updates, index, 'update')),
					),
				);
				expectConverged(replicas);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('converges three replicas after isolated edits and partition healing', async () => {
		await fc.assert(
			fc.asyncProperty(collaborationCaseArbitrary, async (generated) => {
				const baseline = baselineFor(generated.document);
				const updates = await Promise.all(
					generated.nodeIndexes.map((index, updateIndex) =>
						localUpdate(baseline, [
							[index, requiredAt(generated.markdown, updateIndex, 'markdown')],
						]),
					),
				);
				const first = replicaWithUpdates(baseline, [requiredAt(updates, 0, 'update')]);
				const second = replicaWithUpdates(baseline, [requiredAt(updates, 1, 'update')]);
				const third = replicaWithUpdates(baseline, [requiredAt(updates, 2, 'update')]);
				Y.applyUpdate(first, requiredAt(updates, 1, 'update'));
				Y.applyUpdate(second, requiredAt(updates, 2, 'update'));
				Y.applyUpdate(third, requiredAt(updates, 0, 'update'));
				for (const replica of [first, second, third]) {
					for (const update of updates) Y.applyUpdate(replica, update);
				}
				expectConverged([first, second, third]);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('converges mixed operation sequences spanning several nodes', async () => {
		await fc.assert(
			fc.asyncProperty(collaborationCaseArbitrary, async (generated) => {
				const baseline = baselineFor(generated.document);
				const updates = await Promise.all([
					localUpdate(baseline, [
						[0, generated.markdown[0]],
						[1, generated.markdown[1]],
					]),
					localUpdate(baseline, [
						[1, generated.markdown[2]],
						[2, generated.markdown[3]],
					]),
					localUpdate(baseline, [
						[2, generated.markdown[4]],
						[0, generated.markdown[5]],
					]),
				]);
				expectConverged([
					replicaWithUpdates(baseline, updates),
					replicaWithUpdates(baseline, [
						requiredAt(updates, 2, 'update'),
						requiredAt(updates, 0, 'update'),
						requiredAt(updates, 1, 'update'),
					]),
					replicaWithUpdates(baseline, [
						requiredAt(updates, 1, 'update'),
						requiredAt(updates, 2, 'update'),
						requiredAt(updates, 0, 'update'),
					]),
				]);
			}),
			PROPERTY_PARAMETERS,
		);
	}, 10_000);

	it('converges concurrent replacements of the same Markdown value', async () => {
		await fc.assert(
			fc.asyncProperty(collaborationCaseArbitrary, async (generated) => {
				const baseline = baselineFor(generated.document);
				const nodeIndex = generated.nodeIndexes[0];
				const updates = await Promise.all(
					generated.markdown
						.slice(0, 3)
						.map((markdown) => localUpdate(baseline, [[nodeIndex, markdown]])),
				);
				expectConverged([
					replicaWithUpdates(baseline, updates),
					replicaWithUpdates(baseline, [...updates].reverse()),
				]);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('produces identical state vectors after complete synchronization', async () => {
		await fc.assert(
			fc.asyncProperty(collaborationCaseArbitrary, async (generated) => {
				const baseline = baselineFor(generated.document);
				const updates = await Promise.all(
					generated.nodeIndexes.map((index, updateIndex) =>
						localUpdate(baseline, [
							[index, requiredAt(generated.markdown, updateIndex, 'markdown')],
						]),
					),
				);
				const replicas = updateOrders.slice(0, 3).map((order) =>
					replicaWithUpdates(
						baseline,
						order.map((index) => requiredAt(updates, index, 'update')),
					),
				);
				const vectors = replicas.map((replica) => Y.encodeStateVector(replica));
				expect(vectors[1]).toEqual(vectors[0]);
				expect(vectors[2]).toEqual(vectors[0]);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('restores a snapshot, continues editing and reconverges with active replicas', async () => {
		await fc.assert(
			fc.asyncProperty(collaborationCaseArbitrary, async (generated) => {
				const baseline = baselineFor(generated.document);
				const firstUpdate = await localUpdate(baseline, [[0, generated.markdown[0]]]);
				const secondUpdate = await localUpdate(baseline, [[1, generated.markdown[1]]]);
				const combined = replicaWithUpdates(baseline, [firstUpdate, secondUpdate]);
				const restored = replicaFrom(Y.encodeStateAsUpdate(combined));
				const restoredState = Y.encodeStateVector(restored);
				await applyMarkdown(restored, 2, generated.markdown[2]);
				const restoredUpdate = Y.encodeStateAsUpdate(restored, restoredState);

				const first = replicaWithUpdates(baseline, [firstUpdate, secondUpdate, restoredUpdate]);
				const second = replicaWithUpdates(baseline, [secondUpdate, restoredUpdate, firstUpdate]);
				const firstState = Y.encodeStateVector(first);
				await applyMarkdown(first, generated.nodeIndexes[0], generated.markdown[3]);
				const continuation = Y.encodeStateAsUpdate(first, firstState);
				Y.applyUpdate(second, continuation);
				Y.applyUpdate(restored, continuation);
				expectConverged([first, second, restored]);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});

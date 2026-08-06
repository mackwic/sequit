import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
	YJS_LIVE_DOCUMENT_FORMAT,
} from '../../src/lib/collaboration/yjs-document-codec';
import {
	replaceNodeMarkdown,
	YjsDocumentRepository,
} from '../../src/lib/collaboration/yjs-document-repository';
import { attachDocumentSession } from '../../src/lib/collaboration/yjs-document-session';
import { LocalDocumentCommandGateway } from '../../src/lib/document/document-command-gateway';
import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicRelation,
	type NewLogicNode,
} from '../../src/lib/document/logic-document';
import { orderKey } from '../../src/lib/document/order-key';
import { orderEndpoints } from '../../src/lib/layout/endpoint-order';
import { fractionalOrderKeySpace } from '../../src/lib/layout/order-key-space';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

async function referenceDocument(): Promise<LogicDocument> {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	return parsed.value;
}

function crossingDocument(): LogicDocument {
	return {
		persistenceFormat: 2,
		id: 'crossing-document',
		title: 'Crossing document',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: [],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'source-a',
				natureId: 'goal',
				markdown: 'Source A',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 'source-b',
				natureId: 'goal',
				markdown: 'Source B',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Node,
				id: 'target-a',
				natureId: 'goal',
				markdown: 'Target A',
				layoutOrder: orderKey('a2'),
			},
			{
				kind: EndpointKind.Node,
				id: 'target-b',
				natureId: 'goal',
				markdown: 'Target B',
				layoutOrder: orderKey('a3'),
			},
			{
				kind: EndpointKind.Node,
				id: 'successor',
				natureId: 'goal',
				markdown: 'Successor',
				layoutOrder: orderKey('a4'),
			},
		],
		junctions: [],
		relations: [
			{ id: 'source-b-to-target-a', from: 'source-b', to: 'target-a' },
			{ id: 'target-a-to-successor', from: 'target-a', to: 'successor' },
			{ id: 'target-b-to-successor', from: 'target-b', to: 'successor' },
		],
	};
}

function twoCrossingComponentsDocument(): LogicDocument {
	const components = ['first', 'second'].map((prefix, componentIndex) => {
		const offset = componentIndex * 5;
		const node = (suffix: string, keyOffset: number) => ({
			kind: EndpointKind.Node as const,
			id: `${prefix}-${suffix}`,
			natureId: 'goal',
			markdown: `${prefix} ${suffix}`,
			layoutOrder: orderKey(`a${(offset + keyOffset).toString(36)}`),
		});
		return {
			nodes: [
				node('source-a', 0),
				node('source-b', 1),
				node('target-a', 2),
				node('target-b', 3),
				node('successor', 4),
			],
			relations: [
				{
					id: `${prefix}-source-b-to-target-a`,
					from: `${prefix}-source-b`,
					to: `${prefix}-target-a`,
				},
				{
					id: `${prefix}-target-a-to-successor`,
					from: `${prefix}-target-a`,
					to: `${prefix}-successor`,
				},
				{
					id: `${prefix}-target-b-to-successor`,
					from: `${prefix}-target-b`,
					to: `${prefix}-successor`,
				},
			],
		};
	});
	return {
		persistenceFormat: 2,
		id: 'two-crossing-components',
		title: 'Two crossing components',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'goal', label: 'Goal', color: '#00aa44' }],
		groups: [],
		nodes: components.flatMap(({ nodes }) => nodes),
		junctions: [],
		relations: components.flatMap(({ relations }) => relations),
	};
}

function ordered(document: LogicDocument): readonly string[] {
	return orderEndpoints([...document.groups, ...document.nodes, ...document.junctions]);
}

function readDocument(ydoc: Y.Doc): LogicDocument {
	const result = readLogicDocument(ydoc);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected a readable Yjs document');
	return result.value;
}
function readFailure(ydoc: Y.Doc) {
	const result = readLogicDocument(ydoc);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('Expected an invalid Yjs document');
	return result.diagnostics;
}

function insertYjsNode(
	document: Y.Doc,
	id: string,
	layoutOrder: ReturnType<typeof orderKey>,
): void {
	const node = new Y.Map<unknown>();
	node.set('natureId', 'goal');
	node.set('markdown', new Y.Text(id));
	node.set('layoutOrder', layoutOrder);
	document.getMap<Y.Map<unknown>>('sequit.nodes').set(id, node);
}

async function dispatchCommand(
	document: Y.Doc,
	command:
		| { readonly kind: 'add-node'; readonly node: NewLogicNode }
		| { readonly kind: 'add-relation'; readonly relation: LogicRelation },
	origin?: unknown,
) {
	const repository = new YjsDocumentRepository(document);
	const gateway = new LocalDocumentCommandGateway(
		() => {
			const current = repository.read();
			if (!current.ok) throw new Error('Expected a readable Yjs document');
			return current.value;
		},
		repository,
		origin,
	);
	try {
		const outcome = await gateway.dispatch(command);
		if (outcome.kind === 'failed') throw outcome.error;
		if (outcome.kind === 'accepted') return { ok: true as const, value: outcome.document };
		return { ok: false as const, diagnostics: outcome.diagnostics };
	} finally {
		gateway.destroy();
		repository.destroy();
	}
}

const addNodeThroughGateway = (document: Y.Doc, node: NewLogicNode, origin?: unknown) =>
	dispatchCommand(document, { kind: 'add-node', node }, origin);
const addRelationThroughGateway = (document: Y.Doc, relation: LogicRelation, origin?: unknown) =>
	dispatchCommand(document, { kind: 'add-relation', relation }, origin);

describe('yjsLiveDocumentFormat', () => {
	it('imports and reads the complete document without semantic loss', async () => {
		const expected = await referenceDocument();
		const ydoc = new Y.Doc();

		importLogicDocument(ydoc, expected);

		expect(ydoc.getMap('sequit.meta').get('yjsLiveDocumentFormat')).toBe(YJS_LIVE_DOCUMENT_FORMAT);
		expect(readDocument(ydoc)).toEqual(expected);
	});

	it('round trips endpoint-local keys through snapshots', async () => {
		const reference = await referenceDocument();
		const source = new Y.Doc();
		importLogicDocument(source, reference);
		expect(source.getMap('sequit.meta').has('endpointOrder')).toBe(false);

		const snapshot = new Y.Doc();
		Y.applyUpdate(snapshot, Y.encodeStateAsUpdate(source));
		const reconstructed = readDocument(snapshot);
		expect(reconstructed).toEqual(reference);
		expect(reconstructed.nodes[0]?.kind).toBe(EndpointKind.Node);
	});

	it.each([
		['sequit.groups', 'groups'],
		['sequit.nodes', 'nodes'],
		['sequit.junctions', 'junctions'],
	] as const)('rejects malformed local keys at the %s endpoint path', async (table, path) => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const collection = ydoc.getMap<Y.Map<unknown>>(table);
		const id = [...collection.keys()][0];
		if (id === undefined) throw new Error(`Expected an endpoint in ${table}`);
		const endpoint = collection.get(id);
		if (!endpoint) throw new Error(`Expected endpoint ${id}`);
		endpoint.set('layoutOrder', 'not a key');

		const result = readLogicDocument(ydoc);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected malformed local key to fail');
		expect(result.diagnostics).toContainEqual({
			code: 'invalid-yjs-live-document',
			message: `${path}.${id}.layoutOrder must be a valid fractional order key`,
			path: [path, id, 'layoutOrder'],
		});
	});

	it('stores and preserves each exact Markdown value in Y.Text', async () => {
		const expected = await referenceDocument();
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, expected);

		const node = ydoc.getMap<Y.Map<unknown>>('sequit.nodes').get('traceable-edits');
		const markdown = node?.get('markdown');

		expect(markdown).toBeInstanceOf(Y.Text);
		expect(markdown?.toString()).toBe('ALCOA+: All edits needs to be tracable\n');
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'ALCOA+: All edits needs to be tracable\n',
		);
	});

	it('rejects the previous live document version independently', () => {
		const ydoc = new Y.Doc();
		ydoc.getMap('sequit.meta').set('yjsLiveDocumentFormat', 2);

		expect(readLogicDocument(ydoc)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'unsupported-yjs-live-document-format',
					message: 'Unsupported yjsLiveDocumentFormat: 2',
					path: ['yjsLiveDocumentFormat'],
				},
			],
		});
	});

	it('rejects the previous imported persistence format independently of the live version', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		ydoc.getMap('sequit.meta').set('persistenceFormat', 1);

		expect(readLogicDocument(ydoc)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'invalid-yjs-live-document',
					message: 'Unsupported imported persistenceFormat: 1',
					path: ['persistenceFormat'],
				},
			],
		});
	});
	it('rejects incompatible layout preferences stored in shared metadata', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		ydoc.getMap('sequit.meta').set('layoutBias', 'right');

		expect(readFailure(ydoc)).toContainEqual({
			code: 'invalid-yjs-live-document',
			message: 'Layout bias right is incompatible with direction bottom-to-top',
			path: ['layout', 'bias'],
		});
	});

	it('rejects malformed shared entity and Markdown structures at their logical paths', async () => {
		const malformedEntity = new Y.Doc();
		importLogicDocument(malformedEntity, await referenceDocument());
		malformedEntity.getMap<unknown>('sequit.nodes').set('broken-node', 'not-a-map');

		expect(readFailure(malformedEntity)).toContainEqual(
			expect.objectContaining({
				code: 'invalid-yjs-live-document',
				path: ['nodes', 'broken-node'],
			}),
		);

		const malformedMarkdown = new Y.Doc();
		importLogicDocument(malformedMarkdown, await referenceDocument());
		malformedMarkdown
			.getMap<Y.Map<unknown>>('sequit.nodes')
			.get('traceable-edits')
			?.set('markdown', 'not-a-y-text');

		expect(readFailure(malformedMarkdown)).toContainEqual(
			expect.objectContaining({
				code: 'invalid-yjs-live-document',
				path: ['nodes', 'traceable-edits', 'markdown'],
			}),
		);
	});

	it('revalidates domain references after reading shared state', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		ydoc
			.getMap<Y.Map<unknown>>('sequit.nodes')
			.get('traceable-edits')
			?.set('natureId', 'missing-nature');

		expect(readFailure(ydoc)).toContainEqual({
			code: 'invalid-yjs-live-document',
			message: 'Unknown nature: missing-nature',
			path: ['nodes', 'traceable-edits', 'nature'],
		});
	});

	it('does not create an update when a fine-grained operation cannot find its target', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const stateBefore = Y.encodeStateVector(ydoc);

		expect(replaceNodeMarkdown(ydoc, 'missing-node', 'Ignored')).toBe(false);
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
	});

	it('adds a node and its effective endpoint order in one transaction', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const updates: unknown[] = [];
		ydoc.on('update', (_update, origin) => updates.push(origin));

		const result = await addNodeThroughGateway(ydoc, {
			id: 'zz-new-node',
			natureId: 'goal',
			markdown: 'New goal',
		});

		expect(result.ok).toBe(true);
		expect(updates).toHaveLength(1);
		expect(typeof updates[0]).not.toBe('string');
		const added = readDocument(ydoc).nodes.find(({ id }) => id === 'zz-new-node');
		expect(added).toMatchObject({
			kind: EndpointKind.Node,
			id: 'zz-new-node',
			natureId: 'goal',
			markdown: 'New goal',
		});
		expect(typeof added?.layoutOrder).toBe('string');
		expect(ordered(readDocument(ydoc)).at(-1)).toBe('zz-new-node');
	});

	it('rejects invalid node references without partial writes', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const before = readDocument(ydoc);
		const stateBefore = Y.encodeStateVector(ydoc);

		const result = await addNodeThroughGateway(ydoc, {
			id: 'invalid-node',
			natureId: 'missing-nature',
			groupId: 'missing-group',
			markdown: 'Invalid',
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected invalid node rejection');
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'unknown-nature',
				path: ['nodes', 'invalid-node', 'nature'],
			}),
		);
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
		expect(readDocument(ydoc)).toEqual(before);
	});

	it('preserves sequential node addition order', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());

		for (const id of ['zz-added-first', 'aa-added-second', 'mm-added-third']) {
			const result = await addNodeThroughGateway(ydoc, {
				id,
				natureId: 'goal',
				markdown: id,
			});
			expect(result.ok).toBe(true);
		}

		expect(ordered(readDocument(ydoc)).slice(-3)).toEqual([
			'zz-added-first',
			'aa-added-second',
			'mm-added-third',
		]);
	});

	it('preserves endpoint order under unrelated Markdown edits', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		await addNodeThroughGateway(ydoc, {
			id: 'new-node',
			natureId: 'goal',
			markdown: 'New',
		});
		const keys = readDocument(ydoc).nodes.map(({ id, layoutOrder }) => [id, layoutOrder]);

		expect(replaceNodeMarkdown(ydoc, 'traceable-edits', 'Changed')).toBe(true);
		expect(readDocument(ydoc).nodes.map(({ id, layoutOrder }) => [id, layoutOrder])).toEqual(keys);
	});

	it('adds a relation and its strict-improvement target move in one transaction', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const updates: unknown[] = [];
		const transactionStates: {
			readonly relationPresent: boolean;
			readonly targetOrder?: unknown;
		}[] = [];
		const origin = {};
		const changedEndpointFields = new Map<string, string[]>();
		for (const [id, endpoint] of ydoc.getMap<Y.Map<unknown>>('sequit.nodes')) {
			endpoint.observe((event) =>
				changedEndpointFields.set(id, [...event.keysChanged].map(String)),
			);
		}
		ydoc.on('update', (_update, origin) => updates.push(origin));
		ydoc.on('afterTransaction', (transaction) => {
			if (transaction.origin !== origin) return;
			transactionStates.push({
				relationPresent: ydoc
					.getMap<Y.Map<unknown>>('sequit.relations')
					.has('source-a-to-target-b'),
				targetOrder: ydoc
					.getMap<Y.Map<unknown>>('sequit.nodes')
					.get('target-b')
					?.get('layoutOrder'),
			});
		});

		const result = await addRelationThroughGateway(
			ydoc,
			{
				id: 'source-a-to-target-b',
				from: 'source-a',
				to: 'target-b',
			},
			origin,
		);

		expect(result.ok).toBe(true);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toBe(origin);
		expect(transactionStates).toHaveLength(1);
		expect(transactionStates[0]?.relationPresent).toBe(true);
		expect(typeof transactionStates[0]?.targetOrder).toBe('string');
		expect(changedEndpointFields).toEqual(new Map([['target-b', ['layoutOrder']]]));
		expect(readDocument(ydoc).relations).toContainEqual({
			id: 'source-a-to-target-b',
			from: 'source-a',
			to: 'target-b',
		});
		expect(ordered(readDocument(ydoc))).toEqual([
			'source-a',
			'source-b',
			'target-b',
			'target-a',
			'successor',
		]);
	});

	it('does not accept a command replaced by a before-transaction hook', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const origin = {};
		ydoc.on('beforeTransaction', (transaction) => {
			if (transaction.origin !== origin) return;
			const relation = new Y.Map<unknown>();
			relation.set('from', 'source-b');
			relation.set('to', 'target-a');
			ydoc.getMap<Y.Map<unknown>>('sequit.relations').set('contested', relation);
		});

		await expect(
			addRelationThroughGateway(
				ydoc,
				{ id: 'contested', from: 'source-a', to: 'target-b' },
				origin,
			),
		).rejects.toThrow('Relation addition conflicts with existing id: contested');

		const persisted = readDocument(ydoc).relations.find(({ id }) => id === 'contested');
		expect(persisted).toEqual({ id: 'contested', from: 'source-b', to: 'target-a' });
	});

	it('rolls back a command when a reactive observer invalidates its materialized state', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const nodes = ydoc.getMap<Y.Map<unknown>>('sequit.nodes');
		const stateBefore = Y.encodeStateVector(ydoc);
		nodes.observe((event) => {
			if (!event.keysChanged.has('reactive-node')) return;
			nodes.get('reactive-node')?.set('natureId', 'missing-nature');
		});

		const result = await addNodeThroughGateway(ydoc, {
			id: 'reactive-node',
			natureId: 'goal',
			markdown: 'Reactive node',
		});

		expect(result.ok).toBe(false);
		expect(nodes.has('reactive-node')).toBe(false);
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
	});

	it.each([
		['sequit.groups', 'groups'],
		['sequit.nodes', 'nodes'],
		['sequit.junctions', 'junctions'],
	] as const)('rejects missing keys in %s', async (table, path) => {
		const missing = new Y.Doc();
		importLogicDocument(missing, await referenceDocument());
		const collection = missing.getMap<Y.Map<unknown>>(table);
		const id = [...collection.keys()][0];
		if (id === undefined) throw new Error(`Expected an endpoint in ${table}`);
		collection.get(id)?.delete('layoutOrder');
		const rejected = readLogicDocument(missing);
		expect(rejected).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'invalid-yjs-live-document',
					message: `${path}.${id}.layoutOrder must be a string`,
					path: [path, id, 'layoutOrder'],
				},
			],
		});
	});

	it('keeps duplicate-key reads pure with a canonical ID tie-break', () => {
		const duplicate = new Y.Doc();
		importLogicDocument(duplicate, crossingDocument());
		duplicate.getMap<Y.Map<unknown>>('sequit.nodes').get('source-b')?.set('layoutOrder', 'a0');
		const before = Y.encodeStateVector(duplicate);
		const first = readDocument(duplicate);
		const second = readDocument(duplicate);
		expect(second).toEqual(first);
		expect(ordered(second).slice(0, 2)).toEqual(['source-a', 'source-b']);
		expect(Y.encodeStateVector(duplicate)).toEqual(before);
	});

	it('keeps order unchanged for non-qualifying and no-improvement relation additions', async () => {
		const nonQualifying = new Y.Doc();
		importLogicDocument(nonQualifying, crossingDocument());
		expect(
			(
				await addRelationThroughGateway(nonQualifying, {
					id: 'source-a-to-successor',
					from: 'source-a',
					to: 'successor',
				})
			).ok,
		).toBe(true);
		expect(ordered(readDocument(nonQualifying))).toEqual(ordered(crossingDocument()));

		const noImprovement = new Y.Doc();
		importLogicDocument(noImprovement, crossingDocument());
		expect(
			(
				await addRelationThroughGateway(noImprovement, {
					id: 'source-b-to-target-b',
					from: 'source-b',
					to: 'target-b',
				})
			).ok,
		).toBe(true);
		expect(ordered(readDocument(noImprovement))).toEqual(ordered(crossingDocument()));
	});

	it('rejects duplicate, unknown, and cyclic relations without partial writes', async () => {
		for (const relation of [
			{ id: 'source-b-to-target-a', from: 'source-a', to: 'target-b' },
			{ id: 'unknown', from: 'missing', to: 'target-b' },
			{ id: 'cycle', from: 'successor', to: 'source-b' },
		]) {
			const ydoc = new Y.Doc();
			importLogicDocument(ydoc, crossingDocument());
			const before = readDocument(ydoc);
			const stateBefore = Y.encodeStateVector(ydoc);

			expect((await addRelationThroughGateway(ydoc, relation)).ok).toBe(false);
			expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
			expect(readDocument(ydoc)).toEqual(before);
		}
	});

	it('converges independent fine-grained business operations without replacing collections', async () => {
		const first = new Y.Doc();
		importLogicDocument(first, await referenceDocument());
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);
		const firstCollectionChanges: string[] = [];
		const secondCollectionChanges: string[] = [];
		first
			.getMap('sequit.nodes')
			.observe((event) => firstCollectionChanges.push(...event.keysChanged));
		second
			.getMap('sequit.nodes')
			.observe((event) => secondCollectionChanges.push(...event.keysChanged));

		expect(replaceNodeMarkdown(first, 'traceable-edits', 'First independent edit\n')).toBe(true);
		expect(replaceNodeMarkdown(second, 'training-roi', 'Second independent edit\n')).toBe(true);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		expect(readDocument(first)).toEqual(readDocument(second));
		expect(readDocument(first).nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'traceable-edits', markdown: 'First independent edit\n' }),
				expect.objectContaining({ id: 'training-roi', markdown: 'Second independent edit\n' }),
			]),
		);
		expect(firstCollectionChanges).toEqual([]);
		expect(secondCollectionChanges).toEqual([]);
	});

	it('converges concurrent node additions with distinct endpoint-local keys', async () => {
		const first = new Y.Doc();
		importLogicDocument(first, await referenceDocument());
		const establishedOrder = ordered(readDocument(first));
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);

		expect(
			(
				await addNodeThroughGateway(first, {
					id: 'concurrent-first',
					natureId: 'goal',
					markdown: 'First',
				})
			).ok,
		).toBe(true);
		expect(
			(
				await addNodeThroughGateway(second, {
					id: 'concurrent-second',
					natureId: 'goal',
					markdown: 'Second',
				})
			).ok,
		).toBe(true);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		const firstDocument = readDocument(first);
		const secondDocument = readDocument(second);
		expect(firstDocument).toEqual(secondDocument);
		expect(ordered(firstDocument)).toEqual([
			...establishedOrder,
			'concurrent-first',
			'concurrent-second',
		]);
		expect(ordered(secondDocument)).toEqual([
			...establishedOrder,
			'concurrent-first',
			'concurrent-second',
		]);
		expect(new Set(ordered(firstDocument))).toHaveLength(ordered(firstDocument).length);
		const firstKey = firstDocument.nodes.find(({ id }) => id === 'concurrent-first')?.layoutOrder;
		const secondKey = firstDocument.nodes.find(({ id }) => id === 'concurrent-second')?.layoutOrder;
		expect(firstKey).toBeDefined();
		expect(secondKey).toBeDefined();
		expect(firstKey).not.toBe(secondKey);
	});

	it('converges concurrent endpoint additions in different key intervals', () => {
		const initial = { ...crossingDocument(), relations: [] };
		const first = new Y.Doc();
		importLogicDocument(first, initial);
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);
		const firstKey = fractionalOrderKeySpace.keyFor(
			{ before: orderKey('a0'), after: orderKey('a1') },
			'first-interval',
		);
		const secondKey = fractionalOrderKeySpace.keyFor(
			{ before: orderKey('a3'), after: orderKey('a4') },
			'second-interval',
		);

		insertYjsNode(first, 'first-interval', firstKey);
		insertYjsNode(second, 'second-interval', secondKey);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		expect(readDocument(first)).toEqual(readDocument(second));
		expect(ordered(readDocument(first))).toEqual([
			'source-a',
			'first-interval',
			'source-b',
			'target-a',
			'target-b',
			'second-interval',
			'successor',
		]);
	});

	it('preserves surviving keys and reuses a deleted endpoint interval', () => {
		const initial = { ...crossingDocument(), relations: [] };
		const document = new Y.Doc();
		importLogicDocument(document, initial);
		const keysBefore = new Map(initial.nodes.map(({ id, layoutOrder }) => [id, layoutOrder]));

		document.getMap('sequit.nodes').delete('target-a');
		const afterDeletion = readDocument(document);
		for (const node of afterDeletion.nodes) {
			expect(node.layoutOrder).toBe(keysBefore.get(node.id));
		}
		const replacementKey = fractionalOrderKeySpace.keyFor(
			{ before: orderKey('a1'), after: orderKey('a3') },
			'replacement',
		);
		insertYjsNode(document, 'replacement', replacementKey);

		expect(ordered(readDocument(document))).toEqual([
			'source-a',
			'source-b',
			'replacement',
			'target-b',
			'successor',
		]);
	});

	it('converges concurrent relation moves and survives snapshot reconstruction', async () => {
		const first = new Y.Doc();
		importLogicDocument(first, crossingDocument());
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);

		expect(
			(
				await addRelationThroughGateway(first, {
					id: 'first-source-a-to-target-b',
					from: 'source-a',
					to: 'target-b',
				})
			).ok,
		).toBe(true);
		expect(
			(
				await addRelationThroughGateway(second, {
					id: 'second-source-a-to-target-b',
					from: 'source-a',
					to: 'target-b',
				})
			).ok,
		).toBe(true);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		const snapshot = new Y.Doc();
		Y.applyUpdate(snapshot, Y.encodeStateAsUpdate(first));
		expect(readDocument(first)).toEqual(readDocument(second));
		expect(readDocument(snapshot)).toEqual(readDocument(first));
		expect(ordered(readDocument(snapshot))).toEqual([
			'source-a',
			'source-b',
			'target-b',
			'target-a',
			'successor',
		]);
	});

	it('composes concurrent target-local moves in different components', async () => {
		const initial = twoCrossingComponentsDocument();
		const initialKeys = new Map(initial.nodes.map(({ id, layoutOrder }) => [id, layoutOrder]));
		const first = new Y.Doc();
		importLogicDocument(first, initial);
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);

		expect(
			(
				await addRelationThroughGateway(first, {
					id: 'first-source-a-to-target-b',
					from: 'first-source-a',
					to: 'first-target-b',
				})
			).ok,
		).toBe(true);
		expect(
			(
				await addRelationThroughGateway(second, {
					id: 'second-source-a-to-target-b',
					from: 'second-source-a',
					to: 'second-target-b',
				})
			).ok,
		).toBe(true);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		const converged = readDocument(first);
		expect(readDocument(second)).toEqual(converged);
		expect(ordered(converged)).toEqual([
			'first-source-a',
			'first-source-b',
			'first-target-b',
			'first-target-a',
			'first-successor',
			'second-source-a',
			'second-source-b',
			'second-target-b',
			'second-target-a',
			'second-successor',
		]);
		const changedKeys = converged.nodes
			.filter(({ id, layoutOrder }) => initialKeys.get(id) !== layoutOrder)
			.map(({ id }) => id)
			.sort();
		expect(changedKeys).toEqual(['first-target-b', 'second-target-b']);
	});

	it('composes a concurrent target move with an appended endpoint', async () => {
		const first = new Y.Doc();
		importLogicDocument(first, crossingDocument());
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);

		expect(
			(
				await addRelationThroughGateway(first, {
					id: 'source-a-to-target-b',
					from: 'source-a',
					to: 'target-b',
				})
			).ok,
		).toBe(true);
		expect(
			(
				await addNodeThroughGateway(second, {
					id: 'concurrent-appended',
					natureId: 'goal',
					markdown: 'Concurrent appended',
				})
			).ok,
		).toBe(true);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		expect(readDocument(first)).toEqual(readDocument(second));
		expect(ordered(readDocument(first))).toEqual([
			'source-a',
			'source-b',
			'target-b',
			'target-a',
			'successor',
			'concurrent-appended',
		]);
	});

	it('converges conflicting layout-order writes for the same endpoint', () => {
		const first = new Y.Doc();
		importLogicDocument(first, crossingDocument());
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);
		const beforeTargetB = fractionalOrderKeySpace.keyFor({
			before: orderKey('a2'),
			after: orderKey('a3'),
		});
		const afterTargetB = fractionalOrderKeySpace.keyFor({
			before: orderKey('a3'),
			after: orderKey('a4'),
		});
		const firstTarget = first.getMap<Y.Map<unknown>>('sequit.nodes').get('target-a');
		const secondTarget = second.getMap<Y.Map<unknown>>('sequit.nodes').get('target-a');
		if (!firstTarget || !secondTarget) throw new Error('Expected target-a on both replicas');

		firstTarget.set('layoutOrder', afterTargetB);
		secondTarget.set('layoutOrder', beforeTargetB);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		const firstDocument = readDocument(first);
		const secondDocument = readDocument(second);
		const winningKey = firstDocument.nodes.find(({ id }) => id === 'target-a')?.layoutOrder;
		expect(firstDocument).toEqual(secondDocument);
		expect([beforeTargetB, afterTargetB]).toContain(winningKey);
		let expectedOrder = ['source-a', 'source-b', 'target-a', 'target-b', 'successor'];
		if (winningKey === afterTargetB) {
			expectedOrder = ['source-a', 'source-b', 'target-b', 'target-a', 'successor'];
		}
		expect(ordered(firstDocument)).toEqual(expectedOrder);

		const snapshot = new Y.Doc();
		Y.applyUpdate(snapshot, Y.encodeStateAsUpdate(first));
		expect(readDocument(snapshot)).toEqual(firstDocument);
	});

	it('rejects a relation cycle introduced by concurrent replica merges', async () => {
		const first = new Y.Doc();
		importLogicDocument(first, crossingDocument());
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);

		expect(
			(
				await addRelationThroughGateway(first, {
					id: 'source-a-to-source-b',
					from: 'source-a',
					to: 'source-b',
				})
			).ok,
		).toBe(true);
		expect(
			(
				await addRelationThroughGateway(second, {
					id: 'source-b-to-source-a',
					from: 'source-b',
					to: 'source-a',
				})
			).ok,
		).toBe(true);
		const firstUpdate = Y.encodeStateAsUpdate(first, firstState);
		const secondUpdate = Y.encodeStateAsUpdate(second, secondState);
		Y.applyUpdate(first, secondUpdate);
		Y.applyUpdate(second, firstUpdate);

		expect(readFailure(first)).toContainEqual({
			code: 'invalid-yjs-live-document',
			message: 'Cycle detected: source-a -> source-b -> source-a',
			path: ['relations'],
		});
		expect(readFailure(second)).toEqual(readFailure(first));
	});

	it('keeps accepting commands from the last valid state after an invalid remote merge', async () => {
		const first = new Y.Doc();
		importLogicDocument(first, crossingDocument());
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);
		const reports: unknown[] = [];
		const session = attachDocumentSession(first, (report) => reports.push(report));
		try {
			await session.addRelation({
				id: 'source-a-to-source-b',
				from: 'source-a',
				to: 'source-b',
			});
			expect(
				(
					await addRelationThroughGateway(second, {
						id: 'source-b-to-source-a',
						from: 'source-b',
						to: 'source-a',
					})
				).ok,
			).toBe(true);
			Y.applyUpdate(first, Y.encodeStateAsUpdate(second, secondState));
			Y.applyUpdate(second, Y.encodeStateAsUpdate(first, firstState));

			expect(reports).toContainEqual(
				expect.objectContaining({ kind: 'rejected-external-transaction' }),
			);
			const accepted = await session.addNode({
				id: 'after-rejection',
				natureId: 'goal',
				markdown: 'After rejection',
			});
			expect(accepted.nodes).toContainEqual(expect.objectContaining({ id: 'after-rejection' }));
		} finally {
			session.destroy();
		}
	});

	it('rejects a relation whose endpoint was concurrently deleted', async () => {
		const deleting = new Y.Doc();
		importLogicDocument(deleting, crossingDocument());
		const relating = new Y.Doc();
		Y.applyUpdate(relating, Y.encodeStateAsUpdate(deleting));
		const deletingState = Y.encodeStateVector(deleting);
		const relatingState = Y.encodeStateVector(relating);

		deleting.getMap('sequit.nodes').delete('source-b');
		expect(
			(
				await addRelationThroughGateway(relating, {
					id: 'source-a-to-source-b',
					from: 'source-a',
					to: 'source-b',
				})
			).ok,
		).toBe(true);
		const deleteUpdate = Y.encodeStateAsUpdate(deleting, deletingState);
		const relationUpdate = Y.encodeStateAsUpdate(relating, relatingState);
		Y.applyUpdate(deleting, relationUpdate);
		Y.applyUpdate(relating, deleteUpdate);

		expect(readFailure(deleting)).toContainEqual({
			code: 'invalid-yjs-live-document',
			message: 'Unknown relation target: source-b',
			path: ['relations', 'source-a-to-source-b', 'to'],
		});
		expect(readFailure(relating)).toEqual(readFailure(deleting));
	});

	it('does not apply a relation when a beforeTransaction hook invalidates the live state', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		let invalidate = true;
		ydoc.on('beforeTransaction', () => {
			if (!invalidate) return;
			invalidate = false;
			ydoc.getMap('sequit.nodes').delete('source-b');
		});

		const outcome = await addRelationThroughGateway(ydoc, {
			id: 'guarded-relation',
			from: 'source-a',
			to: 'target-b',
		});

		expect(outcome.ok).toBe(false);
		expect(ydoc.getMap('sequit.nodes').has('source-b')).toBe(false);
		expect(ydoc.getMap('sequit.relations').has('guarded-relation')).toBe(false);
	});

	it('omits a concurrently deleted endpoint when another replica moves order', async () => {
		const initial = {
			...crossingDocument(),
			nodes: [
				...crossingDocument().nodes,
				{
					kind: EndpointKind.Node as const,
					id: 'discarded',
					natureId: 'goal',
					markdown: 'Discarded',
					layoutOrder: orderKey('a5'),
				},
			],
		};
		const deleting = new Y.Doc();
		importLogicDocument(deleting, initial);
		const moving = new Y.Doc();
		Y.applyUpdate(moving, Y.encodeStateAsUpdate(deleting));
		const deletingState = Y.encodeStateVector(deleting);
		const movingState = Y.encodeStateVector(moving);

		deleting.getMap('sequit.nodes').delete('discarded');
		expect(
			(
				await addRelationThroughGateway(moving, {
					id: 'source-a-to-target-b',
					from: 'source-a',
					to: 'target-b',
				})
			).ok,
		).toBe(true);
		const deleteUpdate = Y.encodeStateAsUpdate(deleting, deletingState);
		const moveUpdate = Y.encodeStateAsUpdate(moving, movingState);
		Y.applyUpdate(deleting, moveUpdate);
		Y.applyUpdate(moving, deleteUpdate);

		const stateBeforeRead = Y.encodeStateVector(deleting);
		expect(readDocument(deleting)).toEqual(readDocument(moving));
		expect(ordered(readDocument(deleting))).not.toContain('discarded');
		expect(Y.encodeStateVector(deleting)).toEqual(stateBeforeRead);
	});
});

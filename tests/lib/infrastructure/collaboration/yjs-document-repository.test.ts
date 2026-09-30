import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { nodeCreation, relationCreation } from '../../../../src/app/web/document/document-commands';
import { attachLocalDocumentSession } from '../../../../src/app/web/document/local-document-session';
import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	EndpointKind,
	GroupState,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicRelation,
	type NewLogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { orderEndpoints } from '../../../../src/lib/core/ordering/endpoint-order';
import { fractionalOrderKeySpace } from '../../../../src/lib/core/ordering/order-key-space';
import {
	importLogicDocument,
	readLogicDocument,
	YJS_LIVE_DOCUMENT_FORMAT,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsDocumentRepository } from '../../../../src/lib/infrastructure/collaboration/yjs-document-repository';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { DocumentCommandOutcomeKind } from '../../../../src/lib/infrastructure/document/document-command-contracts';
import {
	SharedCommandKind,
	type SharedDocumentCommand,
	SharedElementKind,
	SharedProperty,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { explicitLaneLogicDocument } from '../../../support/builders/logic-document';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

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

async function dispatchCommands(document: Y.Doc, commands: readonly SharedDocumentCommand[]) {
	const session = attachLocalDocumentSession(document);
	try {
		return await session.dispatch(commands);
	} finally {
		session.destroy();
	}
}

const addNodeThroughSession = (document: Y.Doc, node: NewLogicNode) =>
	dispatchCommands(document, [nodeCreation(node)]);
const addRelationThroughSession = (document: Y.Doc, relation: LogicRelation) =>
	dispatchCommands(document, [relationCreation(relation)]);
const replaceMarkdownThroughSession = (
	document: Y.Doc,
	nodeId: string,
	markdown: string,
): boolean => {
	const session = attachLocalDocumentSession(document);
	try {
		return session.replaceNodeMarkdown(nodeId, markdown);
	} finally {
		session.destroy();
	}
};

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

	it('reports invalid scalar values across all decoded entity kinds', async () => {
		const invalid = new Y.Doc();
		importLogicDocument(invalid, await referenceDocument());
		const meta = invalid.getMap<unknown>('sequit.meta');
		meta.set('layoutDirection', 'diagonal');
		meta.set('layoutBias', 'diagonal');
		const natures = invalid.getMap<Y.Map<unknown>>('sequit.natures');
		const natureId = defined([...natures.keys()][0]);
		defined(natures.get(natureId)).delete('color');
		const junctions = invalid.getMap<Y.Map<unknown>>('sequit.junctions');
		const junctionId = defined([...junctions.keys()][0]);
		defined(junctions.get(junctionId)).set('operator', 'and');
		const relations = invalid.getMap<Y.Map<unknown>>('sequit.relations');
		const relationId = defined([...relations.keys()][0]);
		defined(relations.get(relationId)).delete('to');

		const diagnostics = readFailure(invalid);
		expect(diagnostics.map(({ path }) => path)).toEqual(
			expect.arrayContaining([
				['layout', 'direction'],
				['layout', 'bias'],
				['natures', natureId, 'color'],
				['junctions', junctionId, 'operator'],
				['relations', relationId, 'to'],
			]),
		);
	});

	it('reports a direction-incompatible decoded layout bias', async () => {
		const invalid = new Y.Doc();
		importLogicDocument(invalid, await referenceDocument());
		const meta = invalid.getMap<unknown>('sequit.meta');
		meta.set('layoutDirection', LayoutDirection.TopToBottom);
		meta.set('layoutBias', LayoutBias.Left);

		expect(readFailure(invalid)).toContainEqual({
			code: 'invalid-yjs-live-document',
			message: 'Layout bias left is incompatible with direction top-to-bottom',
			path: ['layout', 'bias'],
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
			message: 'Layout bias right is incompatible with direction top-to-bottom',
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

		const result = replaceMarkdownThroughSession(ydoc, 'missing-node', 'Ignored');

		expect(result).toBe(false);
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
	});

	it('replaces Markdown without replacing the node collection entry', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const nodes = ydoc.getMap<Y.Map<unknown>>('sequit.nodes');
		const node = nodes.get('traceable-edits');
		const collectionChanges: string[] = [];
		const updates: unknown[] = [];
		nodes.observe((event) => collectionChanges.push(...event.keysChanged));
		ydoc.on('update', (_update, updateOrigin) => updates.push(updateOrigin));

		const result = replaceMarkdownThroughSession(
			ydoc,
			'traceable-edits',
			'Typed shared replacement',
		);

		expect(result).toBe(true);
		expect(updates).toHaveLength(1);
		expect(collectionChanges).toEqual([]);
		expect(nodes.get('traceable-edits')).toBe(node);
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'Typed shared replacement',
		);
	});

	it('adds a node and its effective endpoint order in one transaction', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const updates: unknown[] = [];
		ydoc.on('update', (_update, origin) => updates.push(origin));

		const result = await addNodeThroughSession(ydoc, {
			id: 'zz-new-node',
			natureId: 'goal',
			markdown: 'New goal',
		});

		expect(result).toMatchObject({ kind: 'accepted' });
		expect(updates).toHaveLength(1);
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
	it('rejects a new relation cycle before emitting any shared update', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const before = Y.encodeStateVector(ydoc);
		const updates: Uint8Array[] = [];
		ydoc.on('update', (update) => updates.push(update));
		const result = await addRelationThroughSession(ydoc, {
			id: 'back-edge',
			from: 'target-a',
			to: 'source-b',
		});
		expect(result).toMatchObject({
			kind: 'rejected',
			diagnostics: [{ code: 'command-refused' }],
		});
		expect(updates).toEqual([]);
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
		ydoc.destroy();
	});

	it('rejects invalid node references without partial writes', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const before = readDocument(ydoc);
		const stateBefore = Y.encodeStateVector(ydoc);

		const result = await addNodeThroughSession(ydoc, {
			id: 'invalid-node',
			natureId: 'missing-nature',
			groupId: 'missing-group',
			markdown: 'Invalid',
		});

		expect(result).toMatchObject({
			kind: 'rejected',
			diagnostics: [{ code: 'command-refused' }],
		});
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
		expect(readDocument(ydoc)).toEqual(before);
	});

	it('creates the requested node through the shared command', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const outcome = await addNodeThroughSession(ydoc, {
			id: 'described',
			natureId: 'goal',
			markdown: 'Text',
			description: 'Description from writer',
		});
		expect(outcome).toMatchObject({ kind: 'accepted' });
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'described')?.description).toBe(
			'Description from writer',
		);
		ydoc.destroy();
	});

	it('preserves sequential node addition order', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());

		for (const id of ['zz-added-first', 'aa-added-second', 'mm-added-third']) {
			const result = await addNodeThroughSession(ydoc, {
				id,
				natureId: 'goal',
				markdown: id,
			});
			expect(result).toMatchObject({ kind: 'accepted' });
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
		await addNodeThroughSession(ydoc, {
			id: 'new-node',
			natureId: 'goal',
			markdown: 'New',
		});
		const keys = readDocument(ydoc).nodes.map(({ id, layoutOrder }) => [id, layoutOrder]);

		expect(replaceMarkdownThroughSession(ydoc, 'traceable-edits', 'Changed')).toBe(true);
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
		const changedEndpointFields = new Map<string, string[]>();
		for (const [id, endpoint] of ydoc.getMap<Y.Map<unknown>>('sequit.nodes')) {
			endpoint.observe((event) =>
				changedEndpointFields.set(id, [...event.keysChanged].map(String)),
			);
		}
		ydoc.on('update', (_update, origin) => updates.push(origin));
		ydoc.on('afterTransaction', () => {
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

		const result = await addRelationThroughSession(ydoc, {
			id: 'source-a-to-target-b',
			from: 'source-a',
			to: 'target-b',
		});

		expect(result).toMatchObject({ kind: 'accepted' });
		expect(updates).toHaveLength(1);
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
	it.each([EndpointKind.Group, EndpointKind.Node, 'relation'] as const)(
		'rejects duplicate %s additions before touching shared state',
		async (kind) => {
			const initial = crossingDocument();
			const document: LogicDocument = {
				...initial,
				groups: [
					{
						kind: EndpointKind.Group,
						id: 'group',
						label: 'Group',
						layoutOrder: orderKey('a8'),
					},
				],
			};
			const ydoc = new Y.Doc();
			importLogicDocument(ydoc, document);
			const previousVector = Y.encodeStateVector(ydoc);
			const commands: SharedDocumentCommand[] = [];
			if (kind === EndpointKind.Group)
				commands.push({
					op: SharedCommandKind.Create,
					target: { kind: SharedElementKind.Group, id: 'group' },
					properties: { label: 'Duplicate group' },
				});
			if (kind === EndpointKind.Node)
				commands.push(
					nodeCreation({ id: 'source-a', natureId: 'goal', markdown: 'Duplicate node' }),
				);
			if (kind === 'relation') commands.push(relationCreation(defined(initial.relations[0])));

			const result = await dispatchCommands(ydoc, commands);

			expect(result).toMatchObject({
				kind: 'rejected',
				diagnostics: [{ code: 'command-refused' }],
			});
			expect(Y.encodeStateVector(ydoc)).toEqual(previousVector);
			ydoc.destroy();
		},
	);

	it('creates a node with its optional group assignment', async () => {
		const ydoc = new Y.Doc();
		const document: LogicDocument = {
			...crossingDocument(),
			groups: [
				{ kind: EndpointKind.Group, id: 'group', label: 'Group', layoutOrder: orderKey('a8') },
			],
		};
		importLogicDocument(ydoc, document);

		const result = await addNodeThroughSession(ydoc, {
			id: 'grouped-node',
			natureId: 'goal',
			groupId: 'group',
			markdown: 'Grouped',
		});
		expect(result).toMatchObject({ kind: 'accepted' });
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'grouped-node')?.groupId).toBe('group');
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
			await addRelationThroughSession(nonQualifying, {
				id: 'source-a-to-successor',
				from: 'source-a',
				to: 'successor',
			}),
		).toMatchObject({ kind: 'accepted' });
		expect(ordered(readDocument(nonQualifying))).toEqual(ordered(crossingDocument()));

		const noImprovement = new Y.Doc();
		importLogicDocument(noImprovement, crossingDocument());
		expect(
			await addRelationThroughSession(noImprovement, {
				id: 'source-b-to-target-b',
				from: 'source-b',
				to: 'target-b',
			}),
		).toMatchObject({ kind: 'accepted' });
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

			expect(await addRelationThroughSession(ydoc, relation)).toMatchObject({
				kind: 'rejected',
				diagnostics: [{ code: 'command-refused' }],
			});
			expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
			expect(readDocument(ydoc)).toEqual(before);
			ydoc.destroy();
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

		expect(
			replaceMarkdownThroughSession(first, 'traceable-edits', 'First independent edit\n'),
		).toBe(true);
		expect(replaceMarkdownThroughSession(second, 'training-roi', 'Second independent edit\n')).toBe(
			true,
		);
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
			await addNodeThroughSession(first, {
				id: 'concurrent-first',
				natureId: 'goal',
				markdown: 'First',
			}),
		).toMatchObject({ kind: 'accepted' });
		expect(
			await addNodeThroughSession(second, {
				id: 'concurrent-second',
				natureId: 'goal',
				markdown: 'Second',
			}),
		).toMatchObject({ kind: 'accepted' });
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
			await addRelationThroughSession(first, {
				id: 'first-source-a-to-target-b',
				from: 'source-a',
				to: 'target-b',
			}),
		).toMatchObject({ kind: 'accepted' });
		expect(
			await addRelationThroughSession(second, {
				id: 'second-source-a-to-target-b',
				from: 'source-a',
				to: 'target-b',
			}),
		).toMatchObject({ kind: 'accepted' });
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
			await addRelationThroughSession(first, {
				id: 'first-source-a-to-target-b',
				from: 'first-source-a',
				to: 'first-target-b',
			}),
		).toMatchObject({ kind: 'accepted' });
		expect(
			await addRelationThroughSession(second, {
				id: 'second-source-a-to-target-b',
				from: 'second-source-a',
				to: 'second-target-b',
			}),
		).toMatchObject({ kind: 'accepted' });
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
			await addRelationThroughSession(first, {
				id: 'source-a-to-target-b',
				from: 'source-a',
				to: 'target-b',
			}),
		).toMatchObject({ kind: 'accepted' });
		expect(
			await addNodeThroughSession(second, {
				id: 'concurrent-appended',
				natureId: 'goal',
				markdown: 'Concurrent appended',
			}),
		).toMatchObject({ kind: 'accepted' });
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
			await addRelationThroughSession(first, {
				id: 'source-a-to-source-b',
				from: 'source-a',
				to: 'source-b',
			}),
		).toMatchObject({ kind: 'accepted' });
		expect(
			await addRelationThroughSession(second, {
				id: 'source-b-to-source-a',
				from: 'source-b',
				to: 'source-a',
			}),
		).toMatchObject({ kind: 'accepted' });
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

	it('keeps peer state untouched on refusal and valid after structural commands', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
		const session = attachLocalDocumentSession(local);
		const initialLocalState = Y.encodeStateVector(local);
		const initialPeerState = Y.encodeStateVector(peer);
		const peerValidity: boolean[] = [];
		let updateCount = 0;
		local.on('update', (update) => {
			updateCount += 1;
			Y.applyUpdate(peer, update);
			peerValidity.push(readLogicDocument(peer).ok);
		});
		const rejected = await session.dispatch([
			nodeCreation({
				id: 'invalid-node',
				natureId: 'missing-nature',
				markdown: 'Rejected addition',
			}),
		]);
		expect(rejected).toMatchObject({
			kind: 'rejected',
			diagnostics: [{ code: 'command-refused' }],
		});
		expect(updateCount).toBe(0);
		expect(Y.encodeStateVector(local)).toEqual(initialLocalState);
		expect(Y.encodeStateVector(peer)).toEqual(initialPeerState);

		const accepted = await session.dispatch([
			nodeCreation({
				id: 'accepted-node',
				natureId: 'goal',
				markdown: 'Accepted addition',
			}),
		]);
		expect(accepted).toMatchObject({ kind: 'accepted' });
		expect(updateCount).toBe(1);
		expect(peerValidity).toEqual([true]);

		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local, initialPeerState));
		Y.applyUpdate(local, Y.encodeStateAsUpdate(peer, initialLocalState));
		expect(readDocument(peer)).toEqual(readDocument(local));
		expect(Y.encodeStateVector(peer)).toEqual(Y.encodeStateVector(local));
		session.destroy();
		local.destroy();
		peer.destroy();
	});

	it('refuses a physically invalid cycle until a peer repairs its relation', async () => {
		const first = new Y.Doc();
		importLogicDocument(first, crossingDocument());
		const second = new Y.Doc();
		Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
		const firstState = Y.encodeStateVector(first);
		const secondState = Y.encodeStateVector(second);
		const reports: unknown[] = [];
		const session = attachLocalDocumentSession(first, (report) => reports.push(report));
		try {
			expect(
				await session.dispatch([
					relationCreation({
						id: 'source-a-to-source-b',
						from: 'source-a',
						to: 'source-b',
					}),
				]),
			).toMatchObject({ kind: 'accepted' });
			expect(
				await addRelationThroughSession(second, {
					id: 'source-b-to-source-a',
					from: 'source-b',
					to: 'source-a',
				}),
			).toMatchObject({ kind: 'accepted' });
			Y.applyUpdate(first, Y.encodeStateAsUpdate(second, secondState));
			Y.applyUpdate(second, Y.encodeStateAsUpdate(first, firstState));

			expect(reports).toContainEqual(
				expect.objectContaining({ kind: 'rejected-external-transaction' }),
			);
			expect(
				await session.dispatch([
					nodeCreation({
						id: 'after-rejection',
						natureId: 'goal',
						markdown: 'After rejection',
					}),
				]),
			).toMatchObject({
				kind: 'rejected',
				diagnostics: [{ code: 'command-refused' }],
			});
			second.getMap(YjsCollection.Relations).delete('source-b-to-source-a');
			Y.applyUpdate(first, Y.encodeStateAsUpdate(second, Y.encodeStateVector(first)));
			expect(readLogicDocument(first).ok).toBe(true);
			const accepted = await session.dispatch([
				nodeCreation({
					id: 'after-rejection',
					natureId: 'goal',
					markdown: 'After rejection',
				}),
			]);
			expect(accepted).toMatchObject({ kind: 'accepted' });
			if (accepted.kind === DocumentCommandOutcomeKind.Accepted)
				expect(accepted.document.nodes).toContainEqual(
					expect.objectContaining({ id: 'after-rejection' }),
				);
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
			await addRelationThroughSession(relating, {
				id: 'source-a-to-source-b',
				from: 'source-a',
				to: 'source-b',
			}),
		).toMatchObject({ kind: 'accepted' });
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
			await addRelationThroughSession(moving, {
				id: 'source-a-to-target-b',
				from: 'source-a',
				to: 'target-b',
			}),
		).toMatchObject({ kind: 'accepted' });
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

describe('repository presentation and invalid-physical boundaries', () => {
	it('rejects an invalid group state before an update reaches a peer', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, explicitLaneLogicDocument());
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
		const session = attachLocalDocumentSession(local);
		const group = defined(readDocument(local).groups.find(({ id }) => id === 'container'));
		const before = Y.encodeStateVector(local);
		const peerBefore = Y.encodeStateVector(peer);
		const received: Uint8Array[] = [];
		local.on('update', (update) => {
			received.push(update);
			Y.applyUpdate(peer, update);
		});
		const invalid: SharedDocumentCommand = {
			op: SharedCommandKind.Update,
			target: { kind: SharedElementKind.Group, id: group.id },
			set: { state: GroupState.Closed },
			unset: [],
		};
		Reflect.set(invalid.set, 'state', 'invalid');
		const rejected = await session.dispatch([invalid]);
		expect(rejected).toMatchObject({
			kind: 'rejected',
			diagnostics: [{ code: 'command-refused' }],
		});
		expect(received).toEqual([]);
		expect(Y.encodeStateVector(local)).toEqual(before);
		expect(Y.encodeStateVector(peer)).toEqual(peerBefore);
		expect(readDocument(peer).groups.find(({ id }) => id === group.id)?.state).toBeUndefined();
		session.destroy();
		local.destroy();
		peer.destroy();
	});

	it('adds a nested group without losing its parent assignment', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const session = attachLocalDocumentSession(ydoc);
		const accepted = await session.dispatch([
			{
				op: SharedCommandKind.Create,
				target: { kind: SharedElementKind.Group, id: 'parent' },
				properties: { label: 'Parent' },
			},
			{
				op: SharedCommandKind.Create,
				target: { kind: SharedElementKind.Group, id: 'child' },
				properties: { label: 'Child', groupId: 'parent' },
			},
		]);
		expect(accepted).toMatchObject({ kind: 'accepted' });
		expect(session.read().groups.find(({ id }) => id === 'child')?.groupId).toBe('parent');
		expect(ydoc.getMap<Y.Map<unknown>>(YjsCollection.Groups).get('child')?.get('groupId')).toBe(
			'parent',
		);
		session.destroy();
		ydoc.destroy();
	});

	it('updates group state without changing its shared label identity', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, explicitLaneLogicDocument());
		const session = attachLocalDocumentSession(ydoc);
		const group = defined(session.read().groups.find(({ id }) => id === 'container'));
		const shared = defined(ydoc.getMap<Y.Map<unknown>>(YjsCollection.Groups).get(group.id));
		const label = shared.get('label');
		const updated = await session.dispatch([
			{
				op: SharedCommandKind.Update,
				target: { kind: SharedElementKind.Group, id: group.id },
				set: { state: GroupState.Closed },
				unset: [],
			},
		]);
		expect(updated).toMatchObject({ kind: 'accepted' });
		expect(session.read().groups.find(({ id }) => id === group.id)?.state).toBe(GroupState.Closed);
		expect(shared.get('label')).toBe(label);

		expect(
			session.updateText({ kind: SharedElementKind.Group, id: group.id }, 'label', 'Renamed'),
		).toBe(true);
		const renamedGroup = session.read().groups.find(({ id }) => id === group.id);
		expect(renamedGroup).toMatchObject({ label: 'Renamed', state: GroupState.Closed });
		expect(shared.get('label')).toBe(label);

		const cleared = await session.dispatch([
			{
				op: SharedCommandKind.Update,
				target: { kind: SharedElementKind.Group, id: group.id },
				set: {},
				unset: [SharedProperty.State],
			},
		]);
		expect(cleared).toMatchObject({ kind: 'accepted' });
		expect(session.read().groups.find(({ id }) => id === group.id)?.state).toBeUndefined();
		expect(shared.get('label')).toBe(label);
		session.destroy();
		ydoc.destroy();
	});

	it('preserves a new top-level group lane through a shared command', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, explicitLaneLogicDocument());
		const session = attachLocalDocumentSession(ydoc);
		const result = await session.dispatch([
			{
				op: SharedCommandKind.Create,
				target: { kind: SharedElementKind.Group, id: 'new-lane-owner' },
				properties: {
					label: 'New lane owner',
					state: GroupState.Closed,
					laneId: 'right',
				},
			},
		]);

		expect(result).toMatchObject({ kind: 'accepted' });
		expect(session.read().groups.find(({ id }) => id === 'new-lane-owner')).toMatchObject({
			laneId: 'right',
			state: GroupState.Closed,
		});
		session.destroy();
		ydoc.destroy();
	});

	it('does not overwrite a group whose shared label is no longer text', () => {
		const source = explicitLaneLogicDocument();
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, source);
		const session = attachLocalDocumentSession(ydoc);
		const group = defined(source.groups.find(({ id }) => id === 'container'));
		const entity = defined(ydoc.getMap<Y.Map<unknown>>(YjsCollection.Groups).get('container'));
		entity.set('label', 'malformed shared label');
		const stateBefore = Y.encodeStateVector(ydoc);

		expect(
			session.updateText({ kind: SharedElementKind.Group, id: group.id }, 'label', 'Attempted'),
		).toBe(false);
		expect(entity.get('label')).toBe('malformed shared label');
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
		session.destroy();
		ydoc.destroy();
	});

	it('keeps Yjs client clocks monotone across local commands and peer interleaving', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
		const session = attachLocalDocumentSession(local);
		const peerEditOrigin = {};
		const peerNode = defined(peer.getMap<Y.Map<unknown>>('sequit.nodes').get('target-a'));
		const peerMarkdown = peerNode.get('markdown');
		if (!(peerMarkdown instanceof Y.Text)) throw new Error('Expected peer shared Markdown');
		let interleaved = false;
		peer.on('update', (update, origin) => {
			if (origin === peerEditOrigin) Y.applyUpdate(local, update);
		});
		local.on('update', (update) => {
			if (interleaved) return;
			interleaved = true;
			Y.applyUpdate(peer, update);
			expect(readLogicDocument(peer).ok).toBe(true);
			peer.transact(() => {
				peerMarkdown.insert(peerMarkdown.length, ' peer edit');
			}, peerEditOrigin);
		});

		try {
			const first = await session.dispatch([
				nodeCreation({
					id: 'clocked-first',
					natureId: 'goal',
					markdown: 'First command',
				}),
			]);
			expect(first).toMatchObject({ kind: 'accepted' });
			expect(interleaved).toBe(true);
			expect(readLogicDocument(local).ok).toBe(true);
			expect(readLogicDocument(peer).ok).toBe(true);
			expect(Y.encodeStateVector(local)).toEqual(Y.encodeStateVector(peer));
			expect(readDocument(local)).toEqual(readDocument(peer));

			const localBeforeNext = Y.encodeStateVector(local);
			const peerBeforeNext = Y.encodeStateVector(peer);
			const next = await session.dispatch([
				nodeCreation({
					id: 'clocked-next',
					natureId: 'goal',
					markdown: 'Next command',
				}),
			]);
			expect(next).toMatchObject({ kind: 'accepted' });
			Y.applyUpdate(peer, Y.encodeStateAsUpdate(local, peerBeforeNext));
			Y.applyUpdate(local, Y.encodeStateAsUpdate(peer, localBeforeNext));
			expect(readDocument(local)).toEqual(readDocument(peer));
			expect(Y.encodeStateVector(local)).toEqual(Y.encodeStateVector(peer));
		} finally {
			session.destroy();
			local.destroy();
			peer.destroy();
		}
	});

	it('refuses malformed remote state until explicit repair preserves peer Markdown', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const remote = new Y.Doc();
		Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
		const repository = new YjsDocumentRepository(local);
		const session = attachLocalDocumentSession(local);
		const nodes = local.getMap<Y.Map<unknown>>('sequit.nodes');
		const survivor = defined(nodes.get('source-a'));
		const survivingText = survivor.get('markdown');
		if (!(survivingText instanceof Y.Text)) throw new Error('Expected surviving text');
		const damaged = defined(remote.getMap<Y.Map<unknown>>('sequit.nodes').get('source-b'));
		damaged.set('markdown', 'not shared text');
		const remoteSource = defined(remote.getMap<Y.Map<unknown>>('sequit.nodes').get('source-a'));
		const remoteText = remoteSource.get('markdown');
		if (!(remoteText instanceof Y.Text)) throw new Error('Expected remote shared text');
		remoteText.insert(0, 'Remote invalid merge: ');
		damaged.set('natureId', ['invalid nature']);
		remote.getMap(YjsCollection.Nodes).delete('target-b');
		remote.getMap('sequit.nodes').set('malformed-node', 42);
		Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(local)));
		expect(repository.read().ok).toBe(false);
		expect(repository.readAccepted()).toMatchObject({ ok: true });

		const beforeRefusal = Y.encodeStateVector(local);
		const refused = await session.dispatch([
			nodeCreation({
				id: 'refused-node',
				natureId: 'goal',
				markdown: 'Refused',
			}),
		]);
		expect(refused).toMatchObject({
			kind: 'rejected',
			diagnostics: [{ code: 'command-refused' }],
		});
		expect(Y.encodeStateVector(local)).toEqual(beforeRefusal);
		expect(survivingText.toJSON()).toBe('Remote invalid merge: Source A');
		const originalTarget = defined(crossingDocument().nodes.find(({ id }) => id === 'target-b'));
		local.transact(() => {
			const sourceB = defined(nodes.get('source-b'));
			sourceB.set('markdown', new Y.Text('Source B'));
			sourceB.set('natureId', 'goal');
			nodes.delete('malformed-node');
			nodes.set(
				'target-b',
				createYjsEntityMap({
					natureId: originalTarget.natureId,
					markdown: new Y.Text(originalTarget.markdown),
					layoutOrder: originalTarget.layoutOrder,
				}),
			);
		});
		expect(repository.read().ok).toBe(true);
		expect(session.replaceNodeMarkdown('target-a', 'After explicit repair')).toBe(true);
		expect(survivor.get('markdown')).toBe(survivingText);
		expect(survivingText.toJSON()).toBe('Remote invalid merge: Source A');
		expect(session.read().nodes.find(({ id }) => id === 'target-a')?.markdown).toBe(
			'After explicit repair',
		);
		expect(nodes.get('source-b')?.get('natureId')).toBe('goal');
		expect(nodes.get('source-b')?.get('markdown')).toBeInstanceOf(Y.Text);
		expect(nodes.has('malformed-node')).toBe(false);
		expect(nodes.get('target-b')).toBeInstanceOf(Y.Map);
		const beforeRemote = Y.encodeStateVector(remote);
		const beforeLocal = Y.encodeStateVector(local);
		Y.applyUpdate(remote, Y.encodeStateAsUpdate(local, beforeRemote));
		Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, beforeLocal));
		expect(readDocument(remote)).toEqual(readDocument(local));
		expect(Y.encodeStateVector(remote)).toEqual(Y.encodeStateVector(local));
		session.destroy();
		repository.destroy();
		local.destroy();
		remote.destroy();
	});
});

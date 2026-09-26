import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { LocalDocumentCommandGateway } from '../../../../src/app/web/document/document-command-gateway';
import { attachDocumentSession } from '../../../../src/app/web/document/yjs-document-session';
import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	EndpointKind,
	GroupState,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicGroup,
	type LogicNode,
	type LogicRelation,
	type NewLogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type { DocumentChangeSet } from '../../../../src/lib/core/document/topology-edits';
import { orderEndpoints } from '../../../../src/lib/core/ordering/endpoint-order';
import { fractionalOrderKeySpace } from '../../../../src/lib/core/ordering/order-key-space';
import {
	importLogicDocument,
	readLogicDocument,
	YJS_LIVE_DOCUMENT_FORMAT,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { applyYjsDocumentChanges } from '../../../../src/lib/infrastructure/collaboration/yjs-document-mutations';
import { projectYjsDocumentChange } from '../../../../src/lib/infrastructure/collaboration/yjs-document-projection';
import { YjsDocumentRepository } from '../../../../src/lib/infrastructure/collaboration/yjs-document-repository';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import {
	type DocumentCommand,
	DocumentCommandKind,
	DocumentCommandOutcomeKind,
} from '../../../../src/lib/infrastructure/document/document-command-contracts';
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

async function dispatchCommand(document: Y.Doc, command: DocumentCommand, origin?: unknown) {
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
		if (outcome.kind === DocumentCommandOutcomeKind.Failed) throw outcome.error;
		if (outcome.kind === DocumentCommandOutcomeKind.Accepted)
			return { ok: true as const, value: outcome.document };
		return { ok: false as const, diagnostics: outcome.diagnostics };
	} finally {
		gateway.destroy();
		repository.destroy();
	}
}

const addNodeThroughGateway = (document: Y.Doc, node: NewLogicNode, origin?: unknown) =>
	dispatchCommand(document, { kind: DocumentCommandKind.AddNode, node }, origin);
const addRelationThroughGateway = (document: Y.Doc, relation: LogicRelation, origin?: unknown) =>
	dispatchCommand(document, { kind: DocumentCommandKind.AddRelation, relation }, origin);
const replaceMarkdownThroughGateway = (
	document: Y.Doc,
	nodeId: string,
	markdown: string,
	origin?: unknown,
) =>
	dispatchCommand(
		document,
		{ kind: DocumentCommandKind.ReplaceNodeMarkdown, nodeId, markdown },
		origin,
	);

function markdownChanges(nodeId: string, markdown: string): DocumentChangeSet {
	return {
		nodeAdditions: [],
		relationAdditions: [],
		endpointOrderChanges: [],
		nodeMarkdownReplacements: [{ nodeId, markdown }],
	};
}

function canonicalDocument(document: LogicDocument): LogicDocument {
	const byId = <T extends { readonly id: string }>(entries: readonly T[]): T[] =>
		[...entries].sort((left, right) => left.id.localeCompare(right.id));
	return {
		...document,
		natures: byId(document.natures),
		groups: byId(document.groups),
		nodes: byId(
			document.nodes.map((node) => {
				if (node.description !== '') return node;
				const copy = { ...node };
				delete copy.description;
				return copy;
			}),
		),
		junctions: byId(document.junctions),
		relations: byId(document.relations),
	};
}

describe('projected Yjs change differential', () => {
	const grouped = () => ({
		...crossingDocument(),
		groups: [
			{
				kind: EndpointKind.Group as const,
				id: 'group',
				label: 'Group',
				layoutOrder: orderKey('a8'),
			},
		],
	});
	const groupedClosed = () => ({
		...grouped(),
		groups: [{ ...defined(grouped().groups[0]), state: GroupState.Closed }],
	});
	const baseChanges = (): DocumentChangeSet => ({
		nodeAdditions: [],
		relationAdditions: [],
		endpointOrderChanges: [],
		nodeMarkdownReplacements: [],
	});
	it.each([
		[
			'node addition',
			crossingDocument,
			{
				nodeAdditions: [
					{
						kind: EndpointKind.Node,
						id: 'new-node',
						natureId: 'goal',
						markdown: 'Added',
						description: '',
						layoutOrder: orderKey('a9'),
					},
				],
			},
		],
		[
			'relation addition',
			crossingDocument,
			{ relationAdditions: [{ id: 'new-relation', from: 'source-a', to: 'target-a' }] },
		],
		[
			'group addition',
			crossingDocument,
			{
				groupAdditions: [
					{
						kind: EndpointKind.Group,
						id: 'new-group',
						label: 'Added group',
						layoutOrder: orderKey('a8'),
					},
				],
			},
		],
		[
			'endpoint removal',
			crossingDocument,
			{ endpointRemovals: [{ endpointKind: EndpointKind.Node, endpointId: 'source-a' }] },
		],
		['relation removal', crossingDocument, { relationRemovals: ['source-b-to-target-a'] }],
		[
			'endpoint order',
			crossingDocument,
			{
				endpointOrderChanges: [
					{ endpointKind: EndpointKind.Node, endpointId: 'source-a', layoutOrder: orderKey('a9') },
				],
			},
		],
		[
			'Markdown replacement',
			crossingDocument,
			{ nodeMarkdownReplacements: [{ nodeId: 'source-a', markdown: 'Updated' }] },
		],
		[
			'group replacement',
			grouped,
			{
				groupReplacements: [
					{ ...defined(grouped().groups[0]), label: 'Changed group', color: '#aa4455' },
				],
			},
		],
		[
			'group state addition',
			grouped,
			{ groupReplacements: [{ ...defined(grouped().groups[0]), state: GroupState.Closed }] },
		],
		[
			'group state modification',
			groupedClosed,
			{
				groupReplacements: [{ ...defined(groupedClosed().groups[0]), state: GroupState.Expanded }],
			},
		],
		[
			'group state removal',
			groupedClosed,
			{ groupReplacements: [{ ...defined(grouped().groups[0]) }] },
		],
		[
			'endpoint assignment',
			grouped,
			{
				endpointGroupChanges: [
					{ endpointKind: EndpointKind.Node, endpointId: 'source-a', groupId: 'group' },
				],
			},
		],
		[
			'mixed composition',
			crossingDocument,
			{
				groupAdditions: [
					{
						kind: EndpointKind.Group,
						id: 'new-group',
						label: 'Added group',
						layoutOrder: orderKey('a8'),
					},
				],
				nodeAdditions: [
					{
						kind: EndpointKind.Node,
						id: 'new-node',
						natureId: 'goal',
						groupId: 'new-group',
						markdown: 'Added',
						layoutOrder: orderKey('a9'),
					},
				],
				relationAdditions: [{ id: 'new-relation', from: 'source-a', to: 'new-node' }],
				nodeMarkdownReplacements: [{ nodeId: 'source-b', markdown: 'Changed too' }],
			},
		],
	] as const)('%s matches its physical materialization', (_name, initialDocument, delta) => {
		const initial = initialDocument();
		const changes: DocumentChangeSet = { ...baseChanges(), ...delta };
		const projected = projectYjsDocumentChange(initial, changes);
		expect(projected.ok).toBe(true);
		if (!projected.ok) throw new Error('Expected valid projection');
		const physical = new Y.Doc();
		importLogicDocument(physical, initial);
		physical.transact(() => {
			applyYjsDocumentChanges(physical, changes);
		});
		expect(canonicalDocument(projected.value)).toEqual(canonicalDocument(readDocument(physical)));
		physical.destroy();
	});
});

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

		const result = await replaceMarkdownThroughGateway(ydoc, 'missing-node', 'Ignored');

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'node-not-found',
					message: 'Node no longer exists: missing-node',
					path: ['nodes', 'missing-node'],
				},
			],
		});
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
	});

	it('replaces Markdown in one named transaction without replacing the node collection entry', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const nodes = ydoc.getMap<Y.Map<unknown>>('sequit.nodes');
		const node = nodes.get('traceable-edits');
		const collectionChanges: string[] = [];
		const updates: unknown[] = [];
		const origin = {};
		nodes.observe((event) => collectionChanges.push(...event.keysChanged));
		ydoc.on('update', (_update, updateOrigin) => updates.push(updateOrigin));

		const result = await replaceMarkdownThroughGateway(
			ydoc,
			'traceable-edits',
			'Typed repository replacement',
			origin,
		);

		expect(result.ok).toBe(true);
		expect(updates).toEqual([origin]);
		expect(collectionChanges).toEqual([]);
		expect(nodes.get('traceable-edits')).toBe(node);
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'Typed repository replacement',
		);
	});

	it('refuses commands on an uninitialized physical document', async () => {
		const ydoc = new Y.Doc();
		const repository = new YjsDocumentRepository(ydoc);
		const unsupported = repository.read();
		expect(unsupported).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'unsupported-yjs-live-document-format' }],
		});
		expect(repository.readAccepted()).toEqual(unsupported);
		const before = Y.encodeStateVector(ydoc);
		expect(await repository.persist(markdownChanges('missing', 'Not persisted'))).toEqual(
			unsupported,
		);
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
		repository.destroy();
		ydoc.destroy();
	});

	it('refuses a locally invalidated document with an intact Markdown target', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const repository = new YjsDocumentRepository(ydoc);
		defined(ydoc.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('target-a')).set(
			'natureId',
			'missing-nature',
		);
		const before = Y.encodeStateVector(ydoc);
		const result = await repository.persist(
			markdownChanges('source-a', 'Blocked by invalid document'),
		);
		expect(result.ok).toBe(false);
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
		expect(repository.readAccepted().ok).toBe(true);
		repository.destroy();
		ydoc.destroy();
	});

	it('reports a locally deleted target without editing accepted state', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const repository = new YjsDocumentRepository(ydoc);
		ydoc.getMap(YjsCollection.Nodes).delete('source-a');
		const before = Y.encodeStateVector(ydoc);
		expect(repository.readAccepted().ok).toBe(true);
		expect(
			await repository.persist(markdownChanges('source-a', 'Blocked by invalid document')),
		).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'node-not-found' }],
		});
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
		repository.destroy();
		ydoc.destroy();
	});

	it('returns a typed malformed-target diagnostic without a command update', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const repository = new YjsDocumentRepository(ydoc);
		ydoc
			.getMap<Y.Map<unknown>>('sequit.nodes')
			.get('traceable-edits')
			?.set('markdown', 'malformed');
		const stateBefore = Y.encodeStateVector(ydoc);

		const result = await repository.persist(
			markdownChanges('traceable-edits', 'Ignored replacement'),
		);

		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'node-markdown-unavailable',
					message: 'Node Markdown is unavailable: traceable-edits',
					path: ['nodes', 'traceable-edits', 'markdown'],
				},
			],
		});
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
		repository.destroy();
	});

	it('rejects a non-map Markdown target through the same typed repository diagnostic', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const repository = new YjsDocumentRepository(ydoc);
		ydoc.getMap<unknown>('sequit.nodes').set('traceable-edits', 'malformed-node');
		const stateBefore = Y.encodeStateVector(ydoc);

		const result = await repository.persist(markdownChanges('traceable-edits', 'Ignored'));

		expect(result).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'node-markdown-unavailable' }],
		});
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
		repository.destroy();
	});

	it('rejects a Markdown save when the target disappears at guarded transaction time', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const origin = {};
		let removeTarget = true;
		ydoc.on('beforeTransaction', (transaction) => {
			if (transaction.origin !== origin || !removeTarget) return;
			removeTarget = false;
			ydoc.getMap('sequit.nodes').delete('traceable-edits');
		});

		const result = await replaceMarkdownThroughGateway(
			ydoc,
			'traceable-edits',
			'Racing replacement',
			origin,
		);

		expect(result).toMatchObject({
			ok: false,
			diagnostics: [
				{
					code: 'node-not-found',
					message: 'Node no longer exists: traceable-edits',
					path: ['nodes', 'traceable-edits'],
				},
			],
		});
		expect(ydoc.getMap('sequit.nodes').has('traceable-edits')).toBe(false);
	});

	it('reports observer invalidation without undoing or rewriting Yjs history', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, await referenceDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const node = defined(ydoc.getMap<Y.Map<unknown>>('sequit.nodes').get('traceable-edits'));
		const markdown = node.get('markdown');
		if (!(markdown instanceof Y.Text)) throw new Error('Expected shared Markdown');
		const stateBefore = Y.encodeStateVector(ydoc);
		let poison = true;
		markdown.observe(() => {
			if (!poison) return;
			poison = false;
			node.set('natureId', 'missing-nature');
		});

		const result = await repository.persist(
			markdownChanges('traceable-edits', 'Invalidated replacement'),
		);

		expect(result.ok).toBe(false);
		expect(markdown.toJSON()).toBe('Invalidated replacement');
		expect(node.get('natureId')).toBe('missing-nature');
		expect(readLogicDocument(ydoc).ok).toBe(false);
		expect(Y.encodeStateVector(ydoc)).not.toEqual(stateBefore);
		const blocked = await repository.persist(markdownChanges('traceable-edits', 'Not persisted'));
		expect(blocked.ok).toBe(false);
		expect(markdown.toJSON()).toBe('Invalidated replacement');
		repository.destroy();
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

	it('rejects malformed fractional order keys before a peer observes an update', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
		const repository = new YjsDocumentRepository(local);
		const peerValidity: boolean[] = [];
		local.on('update', (update) => {
			Y.applyUpdate(peer, update);
			peerValidity.push(readLogicDocument(peer).ok);
		});
		const result = await repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [
				{ endpointKind: EndpointKind.Node, endpointId: 'source-a', layoutOrder: '!' },
			],
			nodeMarkdownReplacements: [],
		});
		expect(result).toMatchObject({
			ok: false,
			diagnostics: [{ path: ['nodes', 'source-a', 'layoutOrder'] }],
		});
		expect(peerValidity).toEqual([]);
		expect(readDocument(local)).toEqual(readDocument(peer));
		repository.destroy();
		local.destroy();
		peer.destroy();
	});

	it('rejects a new relation cycle before emitting any shared update', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const before = Y.encodeStateVector(ydoc);
		const updates: Uint8Array[] = [];
		ydoc.on('update', (update) => updates.push(update));
		const result = await repository.persist({
			nodeAdditions: [],
			relationAdditions: [{ id: 'back-edge', from: 'target-a', to: 'source-b' }],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
		});
		expect(result).toMatchObject({
			ok: false,
			diagnostics: [expect.objectContaining({ path: ['relations'] })],
		});
		expect(updates).toEqual([]);
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
		repository.destroy();
		ydoc.destroy();
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

	it('commits two Markdown replacements with one peer-valid update and stable surviving text', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
		const repository = new YjsDocumentRepository(local);
		const untouched = local.getMap<Y.Map<unknown>>('sequit.nodes').get('target-a')?.get('markdown');
		const observed: boolean[] = [];
		local.on('update', (update) => {
			Y.applyUpdate(peer, update);
			observed.push(readLogicDocument(peer).ok);
		});
		await repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [
				{ nodeId: 'source-a', markdown: 'First edit' },
				{ nodeId: 'source-b', markdown: 'Second edit' },
			],
		});
		expect(observed).toEqual([true]);
		expect(readDocument(local)).toEqual(readDocument(peer));
		expect(readDocument(peer).nodes.map(({ id, markdown }) => [id, markdown])).toEqual(
			expect.arrayContaining([
				['source-a', 'First edit'],
				['source-b', 'Second edit'],
			]),
		);
		expect(local.getMap<Y.Map<unknown>>('sequit.nodes').get('target-a')?.get('markdown')).toBe(
			untouched,
		);
		repository.destroy();
		local.destroy();
		peer.destroy();
	});

	it('returns the physical accepted node including its description', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const outcome = await repository.persist({
			nodeAdditions: [
				{
					kind: EndpointKind.Node,
					id: 'described',
					natureId: 'goal',
					markdown: 'Text',
					description: 'Description from writer',
					layoutOrder: orderKey('a9'),
				},
			],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
		});
		expect(outcome.ok).toBe(true);
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'described')?.description).toBe(
			'Description from writer',
		);
		repository.destroy();
		ydoc.destroy();
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

		expect((await replaceMarkdownThroughGateway(ydoc, 'traceable-edits', 'Changed')).ok).toBe(true);
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

	it.each([EndpointKind.Group, EndpointKind.Junction])(
		'persists an existing %s endpoint order without changing its identity',
		async (kind) => {
			const ydoc = new Y.Doc();
			importLogicDocument(ydoc, await referenceDocument());
			const repository = new YjsDocumentRepository(ydoc);
			const current = readDocument(ydoc);
			const endpoint = [...current.groups, ...current.junctions].find(
				(candidate) => candidate.kind === kind,
			);
			if (!endpoint) throw new Error(`Expected an existing ${kind}`);
			const change: DocumentChangeSet = {
				nodeAdditions: [],
				relationAdditions: [],
				endpointOrderChanges: [
					{ endpointKind: kind, endpointId: endpoint.id, layoutOrder: orderKey('a9') },
				],
				nodeMarkdownReplacements: [],
			};
			const accepted = await repository.persist(change);
			expect(accepted.ok).toBe(true);
			let collection = YjsCollection.Junctions;
			if (kind === EndpointKind.Group) collection = YjsCollection.Groups;
			expect(ydoc.getMap<Y.Map<unknown>>(collection).get(endpoint.id)?.get('layoutOrder')).toBe(
				orderKey('a9'),
			);
			repository.destroy();
			ydoc.destroy();
		},
	);

	it.each([EndpointKind.Group, EndpointKind.Node, 'relation'] as const)(
		'rejects duplicate %s additions before touching shared state',
		async (kind) => {
			const initial = crossingDocument();
			const document = {
				...initial,
				groups: [
					{
						kind: EndpointKind.Group as const,
						id: 'group',
						label: 'Group',
						layoutOrder: orderKey('a8'),
					},
				],
			};
			const ydoc = new Y.Doc();
			importLogicDocument(ydoc, document);
			const repository = new YjsDocumentRepository(ydoc);
			const previousVector = Y.encodeStateVector(ydoc);
			const groupAdditions: LogicGroup[] = [];
			const nodeAdditions: LogicNode[] = [];
			const relationAdditions: LogicRelation[] = [];
			if (kind === EndpointKind.Group) groupAdditions.push(defined(document.groups[0]));
			if (kind === EndpointKind.Node) nodeAdditions.push(defined(initial.nodes[0]));
			if (kind === 'relation') relationAdditions.push(defined(initial.relations[0]));
			const changes: DocumentChangeSet = {
				groupAdditions,
				nodeAdditions,
				relationAdditions,
				endpointOrderChanges: [],
				nodeMarkdownReplacements: [],
			};
			expect(await repository.persist(changes)).toMatchObject({
				ok: false,
				diagnostics: [{ code: 'entity-already-exists' }],
			});
			expect(Y.encodeStateVector(ydoc)).toEqual(previousVector);
			repository.destroy();
			ydoc.destroy();
		},
	);

	it.each([
		[
			'group replacement',
			'group-not-found',
			{
				groupReplacements: [
					{
						kind: EndpointKind.Group,
						id: 'missing-group',
						label: 'Missing',
						layoutOrder: orderKey('a8'),
					},
				],
			},
		],
		[
			'endpoint order',
			'endpoint-not-found',
			{
				endpointOrderChanges: [
					{
						endpointKind: EndpointKind.Node,
						endpointId: 'missing-node',
						layoutOrder: orderKey('a9'),
					},
				],
			},
		],
	] as const)('returns a typed diagnostic for a missing %s', async (_scenario, code, delta) => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const before = Y.encodeStateVector(ydoc);
		const result = await repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			...delta,
		});
		expect(result).toMatchObject({ ok: false, diagnostics: [{ code }] });
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
		repository.destroy();
		ydoc.destroy();
	});

	it('rejects assignment of an endpoint removed by the same change set', async () => {
		const initial = crossingDocument();
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, {
			...initial,
			groups: [
				{ kind: EndpointKind.Group, id: 'group', label: 'Group', layoutOrder: orderKey('a8') },
			],
		});
		const repository = new YjsDocumentRepository(ydoc);
		const previousVector = Y.encodeStateVector(ydoc);
		expect(
			await repository.persist({
				nodeAdditions: [],
				relationAdditions: [],
				endpointRemovals: [{ endpointKind: EndpointKind.Node, endpointId: 'source-a' }],
				endpointGroupChanges: [
					{ endpointKind: EndpointKind.Node, endpointId: 'source-a', groupId: 'group' },
				],
				endpointOrderChanges: [],
				nodeMarkdownReplacements: [],
			}),
		).toMatchObject({ ok: false, diagnostics: [{ code: 'endpoint-not-found' }] });
		expect(Y.encodeStateVector(ydoc)).toEqual(previousVector);
		repository.destroy();
		ydoc.destroy();
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
		).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'entity-already-exists' }] });

		const persisted = readDocument(ydoc).relations.find(({ id }) => id === 'contested');
		expect(persisted).toEqual({ id: 'contested', from: 'source-b', to: 'target-a' });
	});

	it('rejects a node addition that conflicts during its guarded transaction', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const origin = {};
		ydoc.on('beforeTransaction', (transaction) => {
			if (transaction.origin !== origin) return;
			insertYjsNode(ydoc, 'contested-node', orderKey('a8'));
		});

		await expect(
			addNodeThroughGateway(
				ydoc,
				{ id: 'contested-node', natureId: 'goal', markdown: 'Command' },
				origin,
			),
		).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'entity-already-exists' }] });
	});

	it('rejects a group addition that conflicts during its guarded transaction', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const origin = {};
		ydoc.on('beforeTransaction', (transaction) => {
			if (transaction.origin !== origin) return;
			const group = new Y.Map<unknown>();
			group.set('label', new Y.Text('Concurrent group'));
			group.set('layoutOrder', orderKey('a8'));
			ydoc.getMap<Y.Map<unknown>>('sequit.groups').set('contested-group', group);
		});

		await expect(
			dispatchCommand(
				ydoc,
				{
					kind: DocumentCommandKind.GroupNodes,
					group: { id: 'contested-group', label: 'Command group' },
					nodeIds: ['source-a', 'source-b'],
				},
				origin,
			),
		).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'entity-already-exists' }] });
	});

	it('persists the optional group on a newly added node', async () => {
		const ydoc = new Y.Doc();
		const document: LogicDocument = {
			...crossingDocument(),
			groups: [
				{ kind: EndpointKind.Group, id: 'group', label: 'Group', layoutOrder: orderKey('a8') },
			],
		};
		importLogicDocument(ydoc, document);

		const result = await addNodeThroughGateway(ydoc, {
			id: 'grouped-node',
			natureId: 'goal',
			groupId: 'group',
			markdown: 'Grouped',
		});
		expect(result.ok).toBe(true);
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'grouped-node')?.groupId).toBe('group');
	});

	it('reports an observer-poisoned structure without undoing Yjs history', async () => {
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
		expect(nodes.has('reactive-node')).toBe(true);
		expect(readLogicDocument(ydoc).ok).toBe(false);
		expect(Y.encodeStateVector(ydoc)).not.toEqual(stateBefore);
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

		expect(
			(await replaceMarkdownThroughGateway(first, 'traceable-edits', 'First independent edit\n'))
				.ok,
		).toBe(true);
		expect(
			(await replaceMarkdownThroughGateway(second, 'training-roi', 'Second independent edit\n')).ok,
		).toBe(true);
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

	it('keeps every peer update valid for refused mixed and accepted structural changes', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
		const repository = new YjsDocumentRepository(local);
		const initialLocalState = Y.encodeStateVector(local);
		const initialPeerState = Y.encodeStateVector(peer);
		const peerValidity: boolean[] = [];
		let updateCount = 0;
		local.on('update', (update) => {
			updateCount += 1;
			Y.applyUpdate(peer, update);
			peerValidity.push(readLogicDocument(peer).ok);
		});
		const rejected = await repository.persist({
			nodeAdditions: [
				{
					kind: EndpointKind.Node,
					id: 'invalid-mixed-node',
					natureId: 'missing-nature',
					markdown: 'Rejected addition',
					layoutOrder: orderKey('a5'),
				},
			],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [{ nodeId: 'source-a', markdown: 'must not be mixed in' }],
		});
		expect(rejected.ok).toBe(false);
		expect(updateCount).toBe(0);

		const accepted = await repository.persist({
			nodeAdditions: [
				{
					kind: EndpointKind.Node,
					id: 'accepted-node',
					natureId: 'goal',
					markdown: 'Accepted addition',
					layoutOrder: orderKey('a5'),
				},
			],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
		});
		expect(accepted.ok).toBe(true);
		expect(updateCount).toBe(1);
		expect(peerValidity).toEqual([true]);

		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local, initialPeerState));
		Y.applyUpdate(local, Y.encodeStateAsUpdate(peer, initialLocalState));
		expect(readDocument(peer)).toEqual(readDocument(local));
		expect(Y.encodeStateVector(peer)).toEqual(Y.encodeStateVector(local));
		repository.destroy();
		local.destroy();
		peer.destroy();
	});
	it.each([
		[
			'node reference',
			{
				nodeAdditions: [
					{
						kind: EndpointKind.Node,
						id: 'invalid-node',
						natureId: 'unknown-nature',
						markdown: 'Ignored',
						layoutOrder: orderKey('a9'),
					},
				],
			},
		],
		['relation cycle', { relationAdditions: [{ id: 'cycle', from: 'target-a', to: 'source-b' }] }],
		[
			'endpoint removal with incident relation',
			{ endpointRemovals: [{ endpointKind: EndpointKind.Node, endpointId: 'source-b' }] },
		],
		[
			'malformed endpoint order',
			{
				endpointOrderChanges: [
					{ endpointKind: EndpointKind.Node, endpointId: 'source-a', layoutOrder: '!' },
				],
			},
		],
		[
			'invalid group parent',
			{
				groupAdditions: [
					{
						kind: EndpointKind.Group,
						id: 'orphan-group',
						label: 'Orphan',
						groupId: 'unknown-group',
						layoutOrder: orderKey('a9'),
					},
				],
			},
		],
		[
			'invalid endpoint group',
			{
				endpointGroupChanges: [
					{ endpointKind: EndpointKind.Node, endpointId: 'source-a', groupId: 'unknown-group' },
				],
			},
		],
	] as const)(
		'rejects a mixed Markdown and %s change before publishing',
		async (_name, invalid) => {
			const ydoc = new Y.Doc();
			importLogicDocument(ydoc, crossingDocument());
			const repository = new YjsDocumentRepository(ydoc);
			const stateBefore = Y.encodeStateVector(ydoc);
			const updates: Uint8Array[] = [];
			ydoc.on('update', (update) => updates.push(update));
			const result = await repository.persist({
				nodeAdditions: [],
				relationAdditions: [],
				endpointOrderChanges: [],
				nodeMarkdownReplacements: [
					{ nodeId: 'target-b', markdown: 'Rejected with structural error' },
				],
				...invalid,
			});
			expect(result.ok).toBe(false);
			expect(updates).toEqual([]);
			expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
			repository.destroy();
			ydoc.destroy();
		},
	);

	it('refuses a physically invalid cycle until a peer repairs its relation', async () => {
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
			await expect(
				session.addNode({
					id: 'after-rejection',
					natureId: 'goal',
					markdown: 'After rejection',
				}),
			).rejects.toMatchObject({ diagnostics: [{ code: 'invalid-yjs-live-document' }] });
			second.getMap(YjsCollection.Relations).delete('source-b-to-source-a');
			Y.applyUpdate(first, Y.encodeStateAsUpdate(second, Y.encodeStateVector(first)));
			expect(readLogicDocument(first).ok).toBe(true);
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

	it('rejects a reentrant command until its own transaction can be validated', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const firstOrigin = {};
		let reentrant: ReturnType<YjsDocumentRepository['persist']> | undefined;
		repository.observe((_result, origin) => {
			if (origin === firstOrigin)
				reentrant = repository.persist(markdownChanges('source-b', 'Reentrant edit'));
		});
		const first = await repository.persist(markdownChanges('source-a', 'First edit'), firstOrigin);
		expect(first.ok).toBe(true);
		expect(reentrant).toBeDefined();
		const second = await reentrant;
		expect(second).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'document-command-reentrant' }],
		});
		expect(readDocument(ydoc).nodes.find(({ id }) => id === 'source-b')?.markdown).toBe('Source B');
		repository.destroy();
		ydoc.destroy();
	});

	it('rejects a command from a remote transaction observer through cleanup', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const remote = new Y.Doc();
		Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
		const repository = new YjsDocumentRepository(local);
		let nested: ReturnType<YjsDocumentRepository['persist']> | undefined;
		repository.observe((_result, origin) => {
			if (origin === 'remote')
				nested = repository.persist(markdownChanges('source-b', 'Unsafe nested command'));
		});
		let duringUpdate: ReturnType<YjsDocumentRepository['persist']> | undefined;
		local.on('update', (_update, origin) => {
			if (origin === 'remote')
				duringUpdate = repository.persist(markdownChanges('source-b', 'Unsafe update command'));
		});
		local.on('afterTransaction', (transaction) => {
			if (transaction.origin !== 'remote') return;
			local
				.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
				.get('target-b')
				?.set('natureId', 'missing-nature');
		});
		const remoteMarkdown = defined(
			remote.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-a'),
		).get('markdown');
		if (!(remoteMarkdown instanceof Y.Text)) throw new Error('Expected shared Markdown');
		remoteMarkdown.insert(0, 'Remote: ');
		Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(local)), 'remote');
		expect(nested).toBeDefined();
		expect(await nested).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'document-command-reentrant' }],
		});
		expect(duringUpdate).toBeDefined();
		expect(await duringUpdate).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'document-command-reentrant' }],
		});
		expect(repository.read().ok).toBe(false);
		expect(
			local.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-b')?.get('markdown'),
		).toBeInstanceOf(Y.Text);
		expect(readDocument(remote).nodes.find(({ id }) => id === 'source-b')?.markdown).toBe(
			'Source B',
		);
		repository.destroy();
		local.destroy();
		remote.destroy();
	});

	it('never publishes Accepted for a physical document poisoned by an earlier afterTransaction hook', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const origin = {};
		let poisoned = false;
		ydoc.on('afterTransaction', (transaction) => {
			if (transaction.origin !== origin || poisoned) return;
			poisoned = true;
			ydoc
				.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
				.get('source-b')
				?.set('natureId', 'missing-nature');
		});
		const repository = new YjsDocumentRepository(ydoc);
		const publications: boolean[] = [];
		repository.observe((result) => publications.push(result.ok));
		const outcome = await repository.persist(markdownChanges('source-a', 'Poisoned edit'), origin);
		expect(outcome.ok).toBe(false);
		expect(poisoned).toBe(true);
		expect(publications).not.toContain(true);
		expect(repository.read().ok).toBe(false);
		repository.destroy();
		ydoc.destroy();
	});

	it('does not edit a replacement Markdown target installed by beforeTransaction', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const nodes = ydoc.getMap<Y.Map<unknown>>('sequit.nodes');
		const replacementText = new Y.Text('External replacement');
		const replacementNode = createYjsEntityMap({
			natureId: 'goal',
			markdown: replacementText,
			layoutOrder: orderKey('a0'),
		});
		const repository = new YjsDocumentRepository(ydoc);
		let replaced = false;
		const replaceTarget = () => {
			if (replaced) return;
			replaced = true;
			nodes.set('source-a', replacementNode);
		};
		ydoc.on('beforeTransaction', replaceTarget);
		try {
			const result = await repository.persist(markdownChanges('source-a', 'Command replacement'));
			expect(replaced).toBe(true);
			expect(result.ok).toBe(false);
			expect(nodes.get('source-a')).toBe(replacementNode);
			expect(nodes.get('source-a')?.get('markdown')).toBe(replacementText);
			expect(replacementText.toJSON()).toBe('External replacement');
		} finally {
			ydoc.off('beforeTransaction', replaceTarget);
			repository.destroy();
			ydoc.destroy();
		}
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

describe('repository presentation and invalid-physical boundaries', () => {
	it('rejects an invalid group state before an update reaches a peer', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, explicitLaneLogicDocument());
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
		const repository = new YjsDocumentRepository(local);
		const group = defined(readDocument(local).groups.find(({ id }) => id === 'container'));
		const before = Y.encodeStateVector(local);
		const peerBefore = Y.encodeStateVector(peer);
		const received: Uint8Array[] = [];
		local.on('update', (update) => {
			received.push(update);
			Y.applyUpdate(peer, update);
		});
		const invalid = { ...group, state: GroupState.Closed };
		Reflect.set(invalid, 'state', 'invalid');
		const rejected = await repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			groupReplacements: [invalid],
		});
		expect(rejected).toMatchObject({ ok: false });
		expect(received).toEqual([]);
		expect(Y.encodeStateVector(local)).toEqual(before);
		expect(Y.encodeStateVector(peer)).toEqual(peerBefore);
		expect(readDocument(peer).groups.find(({ id }) => id === group.id)?.state).toBeUndefined();
		repository.destroy();
		local.destroy();
		peer.destroy();
	});

	it('adds a nested group without losing its parent assignment', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, crossingDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const accepted = await repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			groupAdditions: [
				{ kind: EndpointKind.Group, id: 'parent', label: 'Parent', layoutOrder: orderKey('a8') },
				{
					kind: EndpointKind.Group,
					id: 'child',
					label: 'Child',
					groupId: 'parent',
					layoutOrder: orderKey('a9'),
				},
			],
		});
		expect(accepted.ok).toBe(true);
		expect(readDocument(ydoc).groups.find(({ id }) => id === 'child')?.groupId).toBe('parent');
		expect(ydoc.getMap<Y.Map<unknown>>(YjsCollection.Groups).get('child')?.get('groupId')).toBe(
			'parent',
		);
		repository.destroy();
		ydoc.destroy();
	});

	it('persists a group state replacement without changing its shared label identity', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, explicitLaneLogicDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const group = defined(readDocument(ydoc).groups.find(({ id }) => id === 'container'));
		const shared = defined(ydoc.getMap<Y.Map<unknown>>(YjsCollection.Groups).get(group.id));
		const label = shared.get('label');
		const updated = await repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			groupReplacements: [{ ...group, state: GroupState.Closed }],
		});
		expect(updated.ok).toBe(true);
		const persisted = readDocument(ydoc).groups.find(({ id }) => id === group.id);
		expect(persisted?.state).toBe(GroupState.Closed);
		expect(shared.get('label')).toBe(label);
		const renamed = await repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			groupReplacements: [{ ...group, label: 'Renamed', state: GroupState.Closed }],
		});
		expect(renamed.ok).toBe(true);
		const renamedGroup = readDocument(ydoc).groups.find(({ id }) => id === group.id);
		expect(renamedGroup).toMatchObject({ label: 'Renamed', state: GroupState.Closed });
		expect(shared.get('label')).toBe(label);
		const cleared = await repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			groupReplacements: [group],
		});
		expect(cleared.ok).toBe(true);
		const reverted = readDocument(ydoc).groups.find(({ id }) => id === group.id);
		expect(reverted?.state).toBeUndefined();
		expect(shared.get('label')).toBe(label);
		repository.destroy();
		ydoc.destroy();
	});

	it('preserves a new top-level group lane through a guarded Yjs transaction', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, explicitLaneLogicDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const change: DocumentChangeSet = {
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			groupAdditions: [
				{
					kind: EndpointKind.Group,
					id: 'new-lane-owner',
					label: 'New lane owner',
					state: GroupState.Closed,
					layoutOrder: orderKey('a8'),
					laneId: 'right',
				},
			],
		};

		const result = await repository.persist(change);

		expect(result.ok).toBe(true);
		expect(readDocument(ydoc).groups.find(({ id }) => id === 'new-lane-owner')).toMatchObject({
			laneId: 'right',
			state: GroupState.Closed,
		});
		repository.destroy();
		ydoc.destroy();
	});

	it('returns diagnostics instead of throwing for a malformed runtime group label', async () => {
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, explicitLaneLogicDocument());
		const repository = new YjsDocumentRepository(ydoc);
		const group = defined(readDocument(ydoc).groups.find(({ id }) => id === 'container'));
		const invalid = { ...group, label: 'Valid label' };
		Reflect.set(invalid, 'label', 42);
		const before = Y.encodeStateVector(ydoc);
		const operation = repository.persist({
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			groupReplacements: [invalid],
		});
		expect(operation).toBeInstanceOf(Promise);
		expect(await operation).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'document-command-invalid' }],
		});
		expect(Y.encodeStateVector(ydoc)).toEqual(before);
		repository.destroy();
		ydoc.destroy();
	});

	it('does not overwrite a group whose shared label was replaced by a malformed value', async () => {
		const source = explicitLaneLogicDocument();
		const ydoc = new Y.Doc();
		importLogicDocument(ydoc, source);
		const repository = new YjsDocumentRepository(ydoc);
		const group = source.groups.find(({ id }) => id === 'container');
		const entity = ydoc.getMap<Y.Map<unknown>>('sequit.groups').get('container');
		if (!group || !entity) throw new Error('Fixture needs container');
		entity.set('label', 'malformed shared label');
		const stateBefore = Y.encodeStateVector(ydoc);
		const change: DocumentChangeSet = {
			nodeAdditions: [],
			relationAdditions: [],
			endpointOrderChanges: [],
			nodeMarkdownReplacements: [],
			groupReplacements: [{ ...group, label: 'Attempted replacement' }],
		};

		expect(await repository.persist(change)).toMatchObject({
			ok: false,
			diagnostics: [{ code: 'group-label-unavailable', path: ['groups', 'container', 'label'] }],
		});
		expect(entity.get('label')).toBe('malformed shared label');
		expect(Y.encodeStateVector(ydoc)).toEqual(stateBefore);
		repository.destroy();
		ydoc.destroy();
	});

	it('keeps all client clocks monotone after hook failure and peer interleaving', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const peer = new Y.Doc();
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
		const repository = new YjsDocumentRepository(local);
		const commandOrigin = {};
		const peerEditOrigin = {};
		let poisoned = false;
		let receivedCommand = false;
		const peerNode = defined(peer.getMap<Y.Map<unknown>>('sequit.nodes').get('target-a'));
		const peerMarkdown = peerNode.get('markdown');
		if (!(peerMarkdown instanceof Y.Text)) throw new Error('Expected peer shared Markdown');
		peer.on('update', (update, origin) => {
			if (origin !== peerEditOrigin) return;
			Y.applyUpdate(local, update);
		});
		local.on('update', (update, origin) => {
			if (origin !== commandOrigin || receivedCommand) return;
			receivedCommand = true;
			Y.applyUpdate(peer, update);
			expect(readLogicDocument(peer).ok).toBe(true);
			peer.transact(() => {
				peerMarkdown.insert(peerMarkdown.length, ' peer edit');
			}, peerEditOrigin);
			if (poisoned) return;
			poisoned = true;
			const localNode = defined(local.getMap<Y.Map<unknown>>('sequit.nodes').get('target-a'));
			localNode.set('natureId', 'missing-nature');
		});

		const failed = await repository.persist(
			markdownChanges('source-a', 'Command with hook failure'),
			commandOrigin,
		);
		expect(failed.ok).toBe(false);
		expect(receivedCommand).toBe(true);
		expect(readLogicDocument(local).ok).toBe(false);
		expect(readLogicDocument(peer).ok).toBe(true);

		const localState = Y.encodeStateVector(local);
		const peerState = Y.encodeStateVector(peer);
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local, peerState));
		Y.applyUpdate(local, Y.encodeStateAsUpdate(peer, localState));
		const repairedNode = defined(local.getMap<Y.Map<unknown>>('sequit.nodes').get('target-a'));
		local.transact(() => repairedNode.set('natureId', 'goal'));
		const repairState = Y.encodeStateVector(local);
		const peerBeforeRepair = Y.encodeStateVector(peer);
		Y.applyUpdate(peer, Y.encodeStateAsUpdate(local, peerBeforeRepair));
		Y.applyUpdate(local, Y.encodeStateAsUpdate(peer, repairState));
		expect(readLogicDocument(local).ok).toBe(true);
		expect(readLogicDocument(peer).ok).toBe(true);
		expect(Y.encodeStateVector(local)).toEqual(Y.encodeStateVector(peer));
		expect(readDocument(local)).toEqual(readDocument(peer));

		const nextOrigin = {};
		local.on('update', (update, origin) => {
			if (origin !== nextOrigin) return;
			Y.applyUpdate(peer, update);
			expect(readLogicDocument(peer).ok).toBe(true);
		});
		const nextEdit = await repository.persist(
			markdownChanges('source-a', 'Monotone next edit'),
			nextOrigin,
		);
		expect(nextEdit.ok).toBe(true);
		expect(readDocument(local)).toEqual(readDocument(peer));
		expect(Y.encodeStateVector(local)).toEqual(Y.encodeStateVector(peer));
		repository.destroy();
		local.destroy();
		peer.destroy();
	});

	it('refuses malformed remote state until explicit repair preserves peer Markdown', async () => {
		const local = new Y.Doc();
		importLogicDocument(local, crossingDocument());
		const remote = new Y.Doc();
		Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
		const repository = new YjsDocumentRepository(local);
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
		const refused = await repository.persist(markdownChanges('target-a', 'After explicit repair'));
		expect(refused.ok).toBe(false);
		if (refused.ok) throw new Error('Expected malformed remote document');
		expect(refused.diagnostics).toContainEqual(
			expect.objectContaining({
				code: 'invalid-yjs-live-document',
				path: ['nodes', 'malformed-node'],
			}),
		);
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
		const accepted = await repository.persist(markdownChanges('target-a', 'After explicit repair'));
		expect(accepted).toEqual(repository.read());
		expect(accepted.ok).toBe(true);
		expect(survivor.get('markdown')).toBe(survivingText);
		expect(survivingText.toJSON()).toBe('Remote invalid merge: Source A');
		expect(readDocument(local).nodes.find(({ id }) => id === 'target-a')?.markdown).toBe(
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
		repository.destroy();
		local.destroy();
		remote.destroy();
	});
});

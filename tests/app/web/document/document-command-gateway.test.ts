import { describe, expect, it, vi } from 'vitest';

import { LocalDocumentCommandGateway } from '../../../../src/app/web/document/document-command-gateway';
import { fractionalOrderKeySpace } from '../../../../src/lib/core/ordering/order-key-space';
import {
	type DocumentChangeRepository,
	DocumentCommandKind,
	DocumentCommandOutcomeKind,
} from '../../../../src/lib/infrastructure/document/document-command-contracts';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

async function referenceDocument() {
	const parsed = parseSequitToml(await aiDocumentaryEffortScenario());
	if (!parsed.ok) throw new Error('Reference document must parse');
	return parsed.value;
}

describe('local document command gateway', () => {
	it('classifies persistence exceptions as failed', async () => {
		const document = await referenceDocument();
		const error = new Error('storage failed');
		const subscriber = vi.fn();
		const repository: DocumentChangeRepository = {
			persist() {
				return Promise.reject(error);
			},
		};
		const gateway = new LocalDocumentCommandGateway(() => document, repository);
		gateway.subscribe(subscriber);

		expect(
			await gateway.dispatch({
				kind: DocumentCommandKind.AddNode,
				node: { id: 'new-node', natureId: 'goal', markdown: 'New node' },
			}),
		).toEqual({
			kind: DocumentCommandOutcomeKind.Failed,
			error,
		});
		expect(subscriber).not.toHaveBeenCalled();
	});

	it('dispatches Markdown replacement through typed persistence and rejects missing nodes first', async () => {
		const document = await referenceDocument();
		const persist = vi.fn<DocumentChangeRepository['persist']>((changes) => {
			const replacement = changes.nodeMarkdownReplacements[0];
			if (replacement === undefined) throw new Error('Expected Markdown replacement');
			return Promise.resolve({
				ok: true,
				value: {
					...document,
					nodes: document.nodes.map((node) => {
						if (node.id !== replacement.nodeId) return node;
						return { ...node, markdown: replacement.markdown };
					}),
				},
			});
		});
		const gateway = new LocalDocumentCommandGateway(() => document, { persist });

		const accepted = await gateway.dispatch({
			kind: DocumentCommandKind.ReplaceNodeMarkdown,
			nodeId: 'traceable-edits',
			markdown: 'Typed replacement',
		});
		expect(accepted.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		if (accepted.kind !== DocumentCommandOutcomeKind.Accepted)
			throw new Error('Expected accepted replacement');
		expect(accepted.document.nodes.find(({ id }) => id === 'traceable-edits')?.markdown).toBe(
			'Typed replacement',
		);
		expect(persist).toHaveBeenCalledWith(
			expect.objectContaining({
				nodeMarkdownReplacements: [{ nodeId: 'traceable-edits', markdown: 'Typed replacement' }],
			}),
			undefined,
		);

		await expect(
			gateway.dispatch({
				kind: DocumentCommandKind.ReplaceNodeMarkdown,
				nodeId: 'missing',
				markdown: 'Ignored',
			}),
		).resolves.toEqual({
			kind: DocumentCommandOutcomeKind.Rejected,
			diagnostics: [
				{
					code: 'node-not-found',
					message: 'Node no longer exists: missing',
					path: ['nodes', 'missing'],
				},
			],
		});
		expect(persist).toHaveBeenCalledOnce();
	});

	it('persists the complete change set before publishing its acceptance', async () => {
		const document = await referenceDocument();
		const events: string[] = [];
		let completePersistence!: (result: {
			readonly ok: true;
			readonly value: typeof document;
		}) => void;
		const persistence = new Promise<{ readonly ok: true; readonly value: typeof document }>(
			(resolve) => {
				completePersistence = resolve;
			},
		);
		const persist = vi.fn<DocumentChangeRepository['persist']>(() => {
			events.push('persist');
			return persistence;
		});
		const gateway = new LocalDocumentCommandGateway(() => document, { persist });
		gateway.subscribe(() => {
			events.push('publish');
		});

		const pending = gateway.dispatch({
			kind: DocumentCommandKind.AddNode,
			node: { id: 'new-node', natureId: 'goal', markdown: 'New node' },
		});
		await vi.waitFor(() => {
			expect(events).toEqual(['persist']);
		});
		const firstPersistCall = persist.mock.calls[0];
		if (firstPersistCall === undefined) throw new Error('Expected persistence to start');
		expect(events).not.toContain('publish');
		completePersistence({
			ok: true,
			value: {
				...document,
				nodes: [...document.nodes, ...firstPersistCall[0].nodeAdditions],
			},
		});
		const outcome = await pending;

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Accepted);
		expect(events).toEqual(['persist', 'publish']);
		expect(persist).toHaveBeenCalledOnce();
		expect(persist.mock.calls[0]?.[0]).toMatchObject({
			nodeAdditions: [
				expect.objectContaining({ id: 'new-node', natureId: 'goal', markdown: 'New node' }),
			],
			relationAdditions: [],
			endpointOrderChanges: [],
		});
		if (outcome.kind !== DocumentCommandOutcomeKind.Accepted)
			throw new Error('Expected accepted command outcome');
		expect(outcome.document.nodes).toContainEqual(expect.objectContaining({ id: 'new-node' }));
	});

	it('serializes concurrent dispatches against the latest authoritative document', async () => {
		const initial = await referenceDocument();
		let current = initial;
		const completions: ((result: { readonly ok: true; readonly value: typeof initial }) => void)[] =
			[];
		const persist = vi.fn<DocumentChangeRepository['persist']>(
			() =>
				new Promise((resolve) => {
					completions.push(resolve);
				}),
		);
		const gateway = new LocalDocumentCommandGateway(() => current, { persist });
		const publications: (typeof initial)[] = [];
		gateway.subscribe((outcome) => {
			if (outcome.kind === DocumentCommandOutcomeKind.Accepted) publications.push(outcome.document);
		});

		const firstPending = gateway.dispatch({
			kind: DocumentCommandKind.AddNode,
			node: { id: 'concurrent-first', natureId: 'goal', markdown: 'First' },
		});
		const secondPending = gateway.dispatch({
			kind: DocumentCommandKind.AddNode,
			node: { id: 'concurrent-second', natureId: 'goal', markdown: 'Second' },
		});
		await vi.waitFor(() => {
			expect(persist).toHaveBeenCalledOnce();
		});
		const persistCallsBeforeFirstCompletion = persist.mock.calls.length;
		const firstCall = persist.mock.calls[0];
		const firstCompletion = completions[0];
		if (firstCall === undefined || firstCompletion === undefined) {
			throw new Error('Expected first persistence call');
		}
		const firstChanges = firstCall[0];
		const firstDocument = {
			...current,
			nodes: [...current.nodes, ...firstChanges.nodeAdditions],
		};
		current = firstDocument;
		firstCompletion({ ok: true, value: firstDocument });
		await expect(firstPending).resolves.toEqual({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: firstDocument,
		});

		await vi.waitFor(() => {
			expect(persist).toHaveBeenCalledTimes(2);
		});
		const secondCall = persist.mock.calls[1];
		const secondCompletion = completions[1];
		if (secondCall === undefined || secondCompletion === undefined) {
			throw new Error('Expected second persistence call');
		}
		const secondChanges = secondCall[0];
		expect(secondChanges.nodeAdditions).toHaveLength(1);
		const firstOrder = firstChanges.nodeAdditions[0]?.layoutOrder;
		const secondOrder = secondChanges.nodeAdditions[0]?.layoutOrder;
		if (firstOrder === undefined || secondOrder === undefined) {
			throw new Error('Expected generated endpoint order keys');
		}
		expect(secondOrder).not.toBe(firstOrder);
		expect(fractionalOrderKeySpace.compare(firstOrder, secondOrder)).toBeLessThan(0);
		const secondDocument = {
			...current,
			nodes: [...current.nodes, ...secondChanges.nodeAdditions],
		};
		current = secondDocument;
		secondCompletion({ ok: true, value: secondDocument });

		await expect(secondPending).resolves.toEqual({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: secondDocument,
		});
		expect(persistCallsBeforeFirstCompletion).toBe(1);
		expect(publications).toEqual([firstDocument, secondDocument]);
		expect(
			secondDocument.nodes.filter(({ id }) => id.startsWith('concurrent-')).map(({ id }) => id),
		).toEqual(['concurrent-first', 'concurrent-second']);
	});

	it('allows persistence already in flight to complete as accepted without publication after destroy', async () => {
		const document = await referenceDocument();
		let completePersistence!: (result: {
			readonly ok: true;
			readonly value: typeof document;
		}) => void;
		const persist = vi.fn<DocumentChangeRepository['persist']>(
			() =>
				new Promise((resolve) => {
					completePersistence = resolve;
				}),
		);
		const gateway = new LocalDocumentCommandGateway(() => document, { persist });
		const existingSubscriber = vi.fn();
		gateway.subscribe(existingSubscriber);

		const pending = gateway.dispatch({
			kind: DocumentCommandKind.AddNode,
			node: { id: 'in-flight', natureId: 'goal', markdown: 'In flight' },
		});
		await vi.waitFor(() => {
			expect(persist).toHaveBeenCalledOnce();
		});
		gateway.destroy();
		const firstCall = persist.mock.calls[0];
		if (firstCall === undefined) throw new Error('Expected persistence call');
		const changes = firstCall[0];
		const accepted = {
			...document,
			nodes: [...document.nodes, ...changes.nodeAdditions],
		};
		completePersistence({ ok: true, value: accepted });

		await expect(pending).resolves.toEqual({
			kind: DocumentCommandOutcomeKind.Accepted,
			document: accepted,
		});
		expect(existingSubscriber).not.toHaveBeenCalled();
	});

	it('rejects subscriptions after destroy', async () => {
		const document = await referenceDocument();
		const gateway = new LocalDocumentCommandGateway(() => document, {
			persist: vi.fn(() => Promise.resolve({ ok: true, value: document } as const)),
		});
		gateway.destroy();

		expect(() => gateway.subscribe(vi.fn())).toThrow('Document command gateway has been destroyed');
	});

	it('returns failed for dispatches started after destroy', async () => {
		const document = await referenceDocument();
		const persist = vi.fn(() => Promise.resolve({ ok: true, value: document } as const));
		const gateway = new LocalDocumentCommandGateway(() => document, { persist });
		gateway.destroy();

		const outcome = await gateway.dispatch({
			kind: DocumentCommandKind.AddNode,
			node: { id: 'after-destroy', natureId: 'goal', markdown: 'After destroy' },
		});

		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Failed);
		if (outcome.kind !== DocumentCommandOutcomeKind.Failed)
			throw new Error('Expected failed command outcome');
		expect(outcome.error).toEqual(new Error('Document command gateway has been destroyed'));
		expect(persist).not.toHaveBeenCalled();
	});

	it('does not start persistence for queued commands when destroyed', async () => {
		const document = await referenceDocument();
		let completePersistence!: (result: {
			readonly ok: true;
			readonly value: typeof document;
		}) => void;
		const persist = vi.fn<DocumentChangeRepository['persist']>(
			() =>
				new Promise((resolve) => {
					completePersistence = resolve;
				}),
		);
		const gateway = new LocalDocumentCommandGateway(() => document, { persist });
		const inFlight = gateway.dispatch({
			kind: DocumentCommandKind.AddNode,
			node: { id: 'in-flight', natureId: 'goal', markdown: 'In flight' },
		});
		const queued = gateway.dispatch({
			kind: DocumentCommandKind.AddNode,
			node: { id: 'queued', natureId: 'goal', markdown: 'Queued' },
		});
		await vi.waitFor(() => {
			expect(persist).toHaveBeenCalledOnce();
		});

		gateway.destroy();
		completePersistence({ ok: true, value: document });

		await expect(inFlight).resolves.toEqual({
			kind: DocumentCommandOutcomeKind.Accepted,
			document,
		});
		await expect(queued).resolves.toMatchObject({ kind: DocumentCommandOutcomeKind.Failed });
		expect(persist).toHaveBeenCalledOnce();
	});

	it('reports every subscriber exception while preserving publication and acceptance', async () => {
		const document = await referenceDocument();
		const firstError = new Error('first isolated error');
		const secondError = new Error('second isolated error');
		const reportSubscriberError = vi.fn<(error: unknown) => void>().mockImplementationOnce(() => {
			throw new Error('reporter failed');
		});
		const gateway = new LocalDocumentCommandGateway(
			() => document,
			{ persist: vi.fn(() => Promise.resolve({ ok: true, value: document } as const)) },
			undefined,
			{ reportSubscriberError },
		);
		const later = vi.fn();
		gateway.subscribe(() => {
			throw firstError;
		});
		gateway.subscribe(later);
		gateway.subscribe(() => {
			throw secondError;
		});

		const outcome = await gateway.dispatch({
			kind: DocumentCommandKind.AddNode,
			node: { id: 'new-node', natureId: 'goal', markdown: 'New node' },
		});

		expect(outcome).toEqual({ kind: DocumentCommandOutcomeKind.Accepted, document });
		expect(later).toHaveBeenCalledOnce();
		expect(later).toHaveBeenCalledWith(outcome);
		expect(reportSubscriberError).toHaveBeenNthCalledWith(1, firstError);
		expect(reportSubscriberError).toHaveBeenNthCalledWith(2, secondError);
	});

	it('returns a failed promise outcome for malformed runtime input without throwing synchronously', async () => {
		const document = await referenceDocument();
		const gateway = new LocalDocumentCommandGateway(() => document, {
			persist: vi.fn(() => Promise.resolve({ ok: true, value: document } as const)),
		});

		// @ts-expect-error Deliberately exercise malformed runtime input.
		const pending = gateway.dispatch({ kind: 'future-command' });

		expect(pending).toBeInstanceOf(Promise);
		const outcome = await pending;
		expect(outcome.kind).toBe(DocumentCommandOutcomeKind.Failed);
		if (outcome.kind !== DocumentCommandOutcomeKind.Failed)
			throw new Error('Expected failed command outcome');
		expect(outcome.error).toBeInstanceOf(TypeError);
	});
});

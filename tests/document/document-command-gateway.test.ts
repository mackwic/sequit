import { describe, expect, it, vi } from 'vitest';

import {
	type DocumentChangeRepository,
	LocalDocumentCommandGateway,
} from '../../src/lib/document/document-command-gateway';
import { fractionalOrderKeySpace } from '../../src/lib/layout/order-key-space';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

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
				kind: 'add-node',
				node: { id: 'new-node', natureId: 'goal', markdown: 'New node' },
			}),
		).toEqual({
			kind: 'failed',
			error,
		});
		expect(subscriber).not.toHaveBeenCalled();
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
			kind: 'add-node',
			node: { id: 'new-node', natureId: 'goal', markdown: 'New node' },
		});
		await vi.waitFor(() => {
			expect(events).toEqual(['persist']);
		});
		expect(events).not.toContain('publish');
		completePersistence({
			ok: true,
			value: {
				...document,
				nodes: [...document.nodes, ...persist.mock.calls[0][0].nodeAdditions],
			},
		});
		const outcome = await pending;

		expect(outcome.kind).toBe('accepted');
		expect(events).toEqual(['persist', 'publish']);
		expect(persist).toHaveBeenCalledOnce();
		expect(persist.mock.calls[0]?.[0]).toMatchObject({
			nodeAdditions: [
				expect.objectContaining({ id: 'new-node', natureId: 'goal', markdown: 'New node' }),
			],
			relationAdditions: [],
			endpointOrderChanges: [],
		});
		if (outcome.kind !== 'accepted') throw new Error('Expected accepted command outcome');
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
			if (outcome.kind === 'accepted') publications.push(outcome.document);
		});

		const firstPending = gateway.dispatch({
			kind: 'add-node',
			node: { id: 'concurrent-first', natureId: 'goal', markdown: 'First' },
		});
		const secondPending = gateway.dispatch({
			kind: 'add-node',
			node: { id: 'concurrent-second', natureId: 'goal', markdown: 'Second' },
		});
		await vi.waitFor(() => {
			expect(persist).toHaveBeenCalledOnce();
		});
		const persistCallsBeforeFirstCompletion = persist.mock.calls.length;
		const firstChanges = persist.mock.calls[0][0];
		const firstDocument = {
			...current,
			nodes: [...current.nodes, ...firstChanges.nodeAdditions],
		};
		current = firstDocument;
		completions[0]({ ok: true, value: firstDocument });
		await expect(firstPending).resolves.toEqual({ kind: 'accepted', document: firstDocument });

		await vi.waitFor(() => {
			expect(persist).toHaveBeenCalledTimes(2);
		});
		const secondChanges = persist.mock.calls[1][0];
		expect(secondChanges.nodeAdditions).toHaveLength(1);
		const firstOrder = firstChanges.nodeAdditions[0]?.layoutOrder;
		const secondOrder = secondChanges.nodeAdditions[0]?.layoutOrder;
		expect(firstOrder).toBeDefined();
		expect(secondOrder).toBeDefined();
		expect(secondOrder).not.toBe(firstOrder);
		expect(fractionalOrderKeySpace.compare(firstOrder, secondOrder)).toBeLessThan(0);
		const secondDocument = {
			...current,
			nodes: [...current.nodes, ...secondChanges.nodeAdditions],
		};
		current = secondDocument;
		completions[1]({ ok: true, value: secondDocument });

		await expect(secondPending).resolves.toEqual({ kind: 'accepted', document: secondDocument });
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
			kind: 'add-node',
			node: { id: 'in-flight', natureId: 'goal', markdown: 'In flight' },
		});
		await vi.waitFor(() => {
			expect(persist).toHaveBeenCalledOnce();
		});
		gateway.destroy();
		const changes = persist.mock.calls[0][0];
		const accepted = {
			...document,
			nodes: [...document.nodes, ...changes.nodeAdditions],
		};
		completePersistence({ ok: true, value: accepted });

		await expect(pending).resolves.toEqual({ kind: 'accepted', document: accepted });
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
			kind: 'add-node',
			node: { id: 'after-destroy', natureId: 'goal', markdown: 'After destroy' },
		});

		expect(outcome.kind).toBe('failed');
		if (outcome.kind !== 'failed') throw new Error('Expected failed command outcome');
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
			kind: 'add-node',
			node: { id: 'in-flight', natureId: 'goal', markdown: 'In flight' },
		});
		const queued = gateway.dispatch({
			kind: 'add-node',
			node: { id: 'queued', natureId: 'goal', markdown: 'Queued' },
		});
		await vi.waitFor(() => {
			expect(persist).toHaveBeenCalledOnce();
		});

		gateway.destroy();
		completePersistence({ ok: true, value: document });

		await expect(inFlight).resolves.toEqual({ kind: 'accepted', document });
		await expect(queued).resolves.toMatchObject({ kind: 'failed' });
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
			kind: 'add-node',
			node: { id: 'new-node', natureId: 'goal', markdown: 'New node' },
		});

		expect(outcome).toEqual({ kind: 'accepted', document });
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

		const pending = gateway.dispatch({ kind: 'future-command' } as never);

		expect(pending).toBeInstanceOf(Promise);
		const outcome = await pending;
		expect(outcome.kind).toBe('failed');
		if (outcome.kind !== 'failed') throw new Error('Expected failed command outcome');
		expect(outcome.error).toBeInstanceOf(TypeError);
	});
});

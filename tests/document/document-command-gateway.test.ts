import { describe, expect, it, vi } from 'vitest';

import {
	type DocumentChangeRepository,
	LocalDocumentCommandGateway,
} from '../../src/lib/document/document-command-gateway';
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

	it('publishes one acceptance to every subscriber even when one throws', async () => {
		const document = await referenceDocument();
		const gateway = new LocalDocumentCommandGateway(() => document, {
			persist: vi.fn(() => Promise.resolve({ ok: true, value: document } as const)),
		});
		const later = vi.fn();
		gateway.subscribe(() => {
			throw new Error('isolated');
		});
		gateway.subscribe(later);

		const outcome = await gateway.dispatch({
			kind: 'add-node',
			node: { id: 'new-node', natureId: 'goal', markdown: 'New node' },
		});

		expect(outcome.kind).toBe('accepted');
		expect(later).toHaveBeenCalledOnce();
		expect(later).toHaveBeenCalledWith(outcome);
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

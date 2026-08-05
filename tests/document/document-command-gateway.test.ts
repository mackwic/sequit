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
		const repository: DocumentChangeRepository = {
			persist() {
				throw error;
			},
		};
		const gateway = new LocalDocumentCommandGateway(() => document, repository);

		expect(gateway.addNode({ id: 'new-node', natureId: 'goal', markdown: 'New node' })).toEqual({
			kind: 'failed',
			error,
		});
	});

	it('publishes one acceptance to every subscriber even when one throws', async () => {
		const document = await referenceDocument();
		const gateway = new LocalDocumentCommandGateway(() => document, { persist: vi.fn() });
		const later = vi.fn();
		gateway.subscribe(() => {
			throw new Error('isolated');
		});
		gateway.subscribe(later);

		const outcome = gateway.addNode({ id: 'new-node', natureId: 'goal', markdown: 'New node' });

		expect(outcome.kind).toBe('accepted');
		expect(later).toHaveBeenCalledOnce();
		expect(later).toHaveBeenCalledWith(outcome);
	});
});

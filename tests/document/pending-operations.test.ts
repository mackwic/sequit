import { describe, expect, it } from 'vitest';

import {
	coalesce,
	type PendingOperation,
	PendingOperationKind,
	retainReplayable,
} from '../../src/lib/document/pending-operations';
import { validLogicDocument } from '../builders/logic-document';

function operation(nodeId: string, markdown: string, proposalId?: string): PendingOperation {
	const base = { kind: PendingOperationKind.ReplaceNodeMarkdown, nodeId, markdown };
	if (proposalId === undefined) return base;
	return { ...base, proposalId };
}

describe('pending operations', () => {
	it('trailing same-node edits coalesce into one operation', () => {
		expect(coalesce([operation('source-a', 'one')], operation('source-a', 'two'))).toEqual([
			operation('source-a', 'two'),
		]);
	});

	it('coalescing clears an assigned proposal id', () => {
		expect(coalesce([operation('source-a', 'one', 'p-1')], operation('source-a', 'two'))).toEqual([
			operation('source-a', 'two'),
		]);
	});

	it('operations on distinct nodes keep their order', () => {
		const queue = [operation('source-a', 'one')];
		expect(coalesce(queue, operation('source-b', 'two'))).toEqual([
			operation('source-a', 'one'),
			operation('source-b', 'two'),
		]);
		expect(queue).toEqual([operation('source-a', 'one')]);
	});

	it('replay retains operations whose target still exists', () => {
		const queued = [operation('source-a', 'one')];
		expect(retainReplayable(queued, validLogicDocument())).toEqual({
			retained: queued,
			dropped: [],
		});
	});

	it('replay drops operations whose target disappeared', () => {
		const queued = [operation('missing', 'one')];
		expect(retainReplayable(queued, validLogicDocument())).toEqual({
			retained: [],
			dropped: queued,
		});
	});

	it('dropped operations are reported and retained ones are unchanged', () => {
		const retained = operation('source-a', 'one', 'p-1');
		const dropped = operation('missing', 'two', 'p-2');
		const result = retainReplayable([retained, dropped], validLogicDocument());
		expect(result).toEqual({ retained: [retained], dropped: [dropped] });
		expect(result.retained[0]).toBe(retained);
	});
});

import { describe, expect, it } from 'vitest';

import {
	documentIdentityGuard,
	runUpdateGuards,
	type UpdateGuard,
	type UpdateGuardContext,
	UpdateGuardDiagnosticCode,
} from '../../src/lib/collaboration/update-guards';
import { createGraph } from '../../src/lib/graph/create-graph';
import { validLogicDocument } from '../builders/logic-document';

function guardContext(): UpdateGuardContext {
	const document = validLogicDocument();
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('Expected the guard fixture to form a graph');
	return {
		proposalId: 'proposal-1',
		acceptedDocument: document,
		candidateDocument: document,
		candidateGraph: graph.value,
	};
}

describe('update guards', () => {
	it('the identity guard accepts an unchanged document id', async () => {
		await expect(runUpdateGuards([documentIdentityGuard], guardContext())).resolves.toEqual({
			ok: true,
		});
	});

	it('the identity guard rejects a changed document id', async () => {
		const context = guardContext();
		const candidateDocument = { ...context.candidateDocument, id: 'changed-document' };

		await expect(
			runUpdateGuards([documentIdentityGuard], { ...context, candidateDocument }),
		).resolves.toEqual({
			ok: false,
			diagnostics: [
				{
					code: UpdateGuardDiagnosticCode.DocumentIdentityChanged,
					message: 'Document id must remain valid-document',
					path: ['document', 'id'],
				},
			],
		});
	});

	it('guards run in configured order', async () => {
		const calls: string[] = [];
		const guards: readonly UpdateGuard[] = ['first', 'second'].map((name) => ({
			name,
			evaluate(): { readonly ok: true } {
				calls.push(name);
				return { ok: true };
			},
		}));

		expect(await runUpdateGuards(guards, guardContext())).toEqual({ ok: true });
		expect(calls).toEqual(['first', 'second']);
	});

	it('evaluation stops at the first rejection', async () => {
		const calls: string[] = [];
		const rejection = {
			ok: false as const,
			diagnostics: [{ code: 'rejected', message: 'Rejected', path: [] }],
		};
		const guards: readonly UpdateGuard[] = [
			{
				name: 'rejecting',
				evaluate() {
					calls.push('rejecting');
					return rejection;
				},
			},
			{
				name: 'unreached',
				evaluate() {
					calls.push('unreached');
					return { ok: true };
				},
			},
		];

		expect(await runUpdateGuards(guards, guardContext())).toBe(rejection);
		expect(calls).toEqual(['rejecting']);
	});

	it('a throwing guard propagates as an internal failure', async () => {
		const failure = new Error('guard failed');
		const throwingGuard: UpdateGuard = {
			name: 'throwing',
			evaluate(): never {
				throw failure;
			},
		};

		await expect(runUpdateGuards([throwingGuard], guardContext())).rejects.toBe(failure);
	});
});

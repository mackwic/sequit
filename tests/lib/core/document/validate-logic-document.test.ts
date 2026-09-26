import { describe, expect, it } from 'vitest';

import {
	type LogicDocument,
	SequitDiagnosticCode,
} from '../../../../src/lib/core/document/logic-document';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { validLogicDocument } from '../../../support/builders/logic-document';

describe('logic document validation', () => {
	it('rejects duplicate relation identities in canonical order while preserving distinct parallel relations', () => {
		const base = validLogicDocument();
		const duplicated: LogicDocument = {
			...base,
			relations: [
				...base.relations,
				{ id: 'choice-to-target', from: 'source-a', to: 'isolated' },
				{ id: 'a-to-choice', from: 'source-b', to: 'isolated' },
			],
		};
		for (const relations of [duplicated.relations, [...duplicated.relations].reverse()]) {
			const result = validateLogicDocument({ ...duplicated, relations });
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error('Expected duplicate relation IDs to fail');
			expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
				{
					code: SequitDiagnosticCode.DuplicateRelationId,
					path: ['relations', 'a-to-choice'],
				},
				{
					code: SequitDiagnosticCode.DuplicateRelationId,
					path: ['relations', 'choice-to-target'],
				},
			]);
		}
		const parallel = {
			...base,
			relations: [...base.relations, { id: 'parallel-2', from: 'choice', to: 'target' }],
		};
		expect(validateLogicDocument(parallel)).toEqual({ ok: true, value: parallel });
	});

	it('rejects an unnamespaced content icon on a node', () => {
		const document = validLogicDocument();
		const malformed: LogicDocument = {
			...document,
			nodes: document.nodes.map((node) => {
				if (node.id !== 'source-a') return node;
				return { ...node, icon: 'https://example.com/icon.svg' };
			}),
		};

		const result = validateLogicDocument(malformed);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected invalid icon to be rejected');
		expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
			{
				code: SequitDiagnosticCode.InvalidValue,
				path: ['nodes', 'source-a', 'icon'],
			},
		]);
	});
});

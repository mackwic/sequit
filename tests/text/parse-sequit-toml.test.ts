import { describe, expect, it } from 'vitest';

import type { DocumentResult, LogicDocument } from '../../src/lib/document/logic-document';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import {
	withDuplicateEndpoint,
	withReorderedTables,
	withUnknownNature,
} from '../perturbators/sequit-source';
import { aiDocumentaryEffortScenario } from '../scenarios/ai-documentary-effort';

async function source(): Promise<string> {
	return aiDocumentaryEffortScenario();
}

function expectFailure(result: DocumentResult<LogicDocument>) {
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('Expected parsing to fail');
	return result.diagnostics;
}

function expectSuccess(result: DocumentResult<LogicDocument>) {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected parsing to succeed');
	return result.value;
}

describe('parseSequitToml', () => {
	it('normalizes invalid TOML syntax', () => {
		const diagnostics = expectFailure(parseSequitToml('persistenceFormat = ['));

		expect(diagnostics[0]).toMatchObject({ code: 'toml-syntax', path: [] });
		expect(diagnostics[0]?.line).toBeTypeOf('number');
		expect(diagnostics[0]?.column).toBeTypeOf('number');
	});

	it('rejects the previous persistenceFormat at its logical path', async () => {
		const invalid = (await source()).replace('persistenceFormat = 2', 'persistenceFormat = 1');

		expect(expectFailure(parseSequitToml(invalid))).toContainEqual(
			expect.objectContaining({
				code: 'unsupported-persistence-format',
				path: ['persistenceFormat'],
			}),
		);
	});

	it('rejects a missing required field at its logical path', async () => {
		const invalid = (await source()).replace('title = "AI for documentary effort"\n', '');

		expect(expectFailure(parseSequitToml(invalid))).toContainEqual(
			expect.objectContaining({ code: 'missing-field', path: ['document', 'title'] }),
		);
	});

	it('rejects identifiers duplicated between endpoint collections', async () => {
		expect(expectFailure(parseSequitToml(withDuplicateEndpoint(await source())))).toContainEqual(
			expect.objectContaining({
				code: 'duplicate-endpoint-id',
				path: ['nodes', 'traceable-edits'],
			}),
		);
	});

	it('rejects an unknown nature at its logical path', async () => {
		expect(expectFailure(parseSequitToml(withUnknownNature(await source())))).toContainEqual(
			expect.objectContaining({
				code: 'unknown-nature',
				path: ['nodes', 'traceable-edits', 'nature'],
			}),
		);
	});

	it('distinguishes invalid field types from missing fields', async () => {
		const invalid = (await source()).replace(
			'[document]\nid = "ai-documentary-effort"\ntitle = "AI for documentary effort"',
			'document = "invalid"',
		);

		expect(expectFailure(parseSequitToml(invalid))).toContainEqual(
			expect.objectContaining({ code: 'invalid-type', path: ['document'] }),
		);
	});

	it('rejects an invalid Markdown type at the exact node path', async () => {
		const invalid = (await source()).replace(
			"markdown = '''\nALCOA+: All edits needs to be tracable\n'''",
			'markdown = 42',
		);

		expect(expectFailure(parseSequitToml(invalid))).toContainEqual(
			expect.objectContaining({
				code: 'invalid-type',
				path: ['nodes', 'traceable-edits', 'markdown'],
			}),
		);
	});

	it('rejects unknown group references for nodes and junctions', async () => {
		const original = await source();
		const invalidNode = original.replace('group = "use-cases"', 'group = "missing-group"');
		const invalidJunction = original.replace(
			'[junctions.word-ui-options]\noperator = "xor"\ngroup = "use-cases"',
			'[junctions.word-ui-options]\noperator = "xor"\ngroup = "missing-group"',
		);

		expect(expectFailure(parseSequitToml(invalidNode))).toContainEqual(
			expect.objectContaining({
				code: 'unknown-group',
				path: ['nodes', 'traceable-edits', 'group'],
			}),
		);
		expect(expectFailure(parseSequitToml(invalidJunction))).toContainEqual(
			expect.objectContaining({
				code: 'unknown-group',
				path: ['junctions', 'word-ui-options', 'group'],
			}),
		);
	});
	it('maps nested groups and rejects unknown parents and containment cycles', async () => {
		const original = await source();
		const nested = original.replace(
			'[groups.data-team]\nlabel = "Data team"',
			'[groups.data-team]\nlabel = "Data team"\ngroup = "use-cases"',
		);
		const unknownParent = nested.replace('group = "use-cases"', 'group = "missing-group"');
		const cycle = nested.replace(
			'[groups.use-cases]\nlabel = "Use cases"',
			'[groups.use-cases]\nlabel = "Use cases"\ngroup = "data-team"',
		);

		expect(
			expectSuccess(parseSequitToml(nested)).groups.find(({ id }) => id === 'data-team'),
		).toMatchObject({ groupId: 'use-cases' });
		expect(expectFailure(parseSequitToml(unknownParent))).toContainEqual(
			expect.objectContaining({
				code: 'unknown-group',
				path: ['groups', 'data-team', 'group'],
			}),
		);
		expect(expectFailure(parseSequitToml(cycle))).toContainEqual({
			code: 'group-cycle',
			message: 'Group nesting cycle: data-team -> use-cases -> data-team',
			path: ['groups', 'use-cases', 'group'],
		});
	});

	it('rejects unsupported layout directions and junction operators', async () => {
		const original = await source();
		const invalidDirection = original.replace(
			'direction = "bottom-to-top"',
			'direction = "sideways"',
		);
		const invalidOperator = original.replace('operator = "xor"', 'operator = "and"');

		expect(expectFailure(parseSequitToml(invalidDirection))).toContainEqual(
			expect.objectContaining({ code: 'invalid-value', path: ['layout', 'direction'] }),
		);
		expect(expectFailure(parseSequitToml(invalidOperator))).toContainEqual(
			expect.objectContaining({
				code: 'invalid-value',
				path: ['junctions', 'word-ui-options', 'operator'],
			}),
		);
	});
	it('requires a compatible layout bias and maps compatible horizontal preferences', async () => {
		const original = await source();
		const missingBias = original.replace('bias = "top"\n', '');
		const incompatibleBias = original.replace(
			'direction = "bottom-to-top"',
			'direction = "left-to-right"',
		);
		const horizontal = incompatibleBias.replace('bias = "top"', 'bias = "left"');

		expect(expectFailure(parseSequitToml(missingBias))).toContainEqual(
			expect.objectContaining({ code: 'missing-field', path: ['layout', 'bias'] }),
		);
		expect(expectFailure(parseSequitToml(incompatibleBias))).toContainEqual(
			expect.objectContaining({ code: 'invalid-value', path: ['layout', 'bias'] }),
		);
		expect(expectSuccess(parseSequitToml(horizontal)).layout).toEqual({
			direction: 'left-to-right',
			bias: 'left',
		});
	});

	it('preserves decoded Markdown including its final newline', async () => {
		const document = expectSuccess(parseSequitToml(await source()));
		const node = document.nodes.find(({ id }) => id === 'traceable-edits');

		expect(node?.markdown).toBe('ALCOA+: All edits needs to be tracable\n');
	});

	it('normalizes collection order by stable identifier', async () => {
		const original = await source();

		expect(expectSuccess(parseSequitToml(withReorderedTables(original)))).toEqual(
			expectSuccess(parseSequitToml(original)),
		);
	});
});

import { describe, expect, it } from 'vitest';

import type { DocumentResult, LogicDocument } from '../../src/lib/document/logic-document';
import { mapSequitDocument } from '../../src/lib/text/map-sequit-document';

function expectFailure(result: DocumentResult<LogicDocument>) {
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('Expected mapping to fail');
	return result.diagnostics;
}

function validRoot(): Record<string, unknown> {
	return {
		persistenceFormat: 1,
		document: { id: 'document', title: 'Document' },
		layout: { direction: 'top-to-bottom', bias: 'top' },
		natures: { goal: { label: 'Goal', color: '#00aa44' } },
		groups: {
			parent: { label: 'Parent' },
			child: { label: 'Child', group: 'parent' },
		},
		nodes: {
			source: { nature: 'goal', group: 'child', markdown: 'Source\n' },
			target: { nature: 'goal', markdown: 'Target\n' },
		},
		junctions: {
			choice: { operator: 'xor', group: 'child' },
			ungrouped: { operator: 'xor' },
		},
		relations: { dependency: { from: 'source', to: 'target' } },
	};
}

describe('mapSequitDocument', () => {
	it('maps optional parent and membership fields when present', () => {
		const result = mapSequitDocument(validRoot());
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected the raw document to map');

		expect(result.value.groups).toContainEqual({ id: 'child', label: 'Child', groupId: 'parent' });
		expect(result.value.nodes).toContainEqual({
			id: 'source',
			natureId: 'goal',
			groupId: 'child',
			markdown: 'Source\n',
		});
		expect(result.value.junctions).toEqual([
			{ id: 'choice', operator: 'xor', groupId: 'child' },
			{ id: 'ungrouped', operator: 'xor' },
		]);
	});

	it('distinguishes a missing root from invalid root container types', () => {
		expect(expectFailure(mapSequitDocument(undefined))).toContainEqual(
			expect.objectContaining({ code: 'missing-field', path: [] }),
		);
		for (const value of [null, [], 'invalid']) {
			expect(expectFailure(mapSequitDocument(value))).toContainEqual(
				expect.objectContaining({ code: 'invalid-type', path: [] }),
			);
		}
	});

	it('collects malformed collection entities and scalar fields in one pass', () => {
		const root = validRoot();
		root['document'] = { id: 42, title: false };
		root['layout'] = { direction: 42, bias: 'diagonal' };
		root['natures'] = {
			'not-a-table': 'invalid',
			'missing-label': { color: '#fff' },
			'missing-color': { label: 'Label' },
		};
		root['groups'] = {
			'not-a-table': 'invalid',
			'missing-label': { group: 42 },
		};
		root['nodes'] = {
			'not-a-table': 'invalid',
			'missing-fields': { nature: 42, group: 42, markdown: false },
		};
		root['junctions'] = {
			'not-a-table': 'invalid',
			'missing-operator': { group: 42 },
			'unknown-operator': { operator: 'and' },
		};
		root['relations'] = {
			'not-a-table': 'invalid',
			'missing-fields': { from: 42, to: false },
		};

		const diagnostics = expectFailure(mapSequitDocument(root));
		expect(diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: ['document', 'id'] }),
				expect.objectContaining({ path: ['layout', 'direction'] }),
				expect.objectContaining({ path: ['natures', 'not-a-table'] }),
				expect.objectContaining({ path: ['groups', 'missing-label', 'group'] }),
				expect.objectContaining({ path: ['nodes', 'missing-fields', 'markdown'] }),
				expect.objectContaining({ path: ['junctions', 'unknown-operator', 'operator'] }),
				expect.objectContaining({ path: ['relations', 'missing-fields', 'to'] }),
			]),
		);
	});

	it('reports every missing top-level collection', () => {
		const root = validRoot();
		delete root['natures'];
		delete root['groups'];
		delete root['nodes'];
		delete root['junctions'];
		delete root['relations'];

		const diagnostics = expectFailure(mapSequitDocument(root));
		for (const name of ['natures', 'groups', 'nodes', 'junctions', 'relations']) {
			expect(diagnostics).toContainEqual(
				expect.objectContaining({ code: 'missing-field', path: [name] }),
			);
		}
	});
});

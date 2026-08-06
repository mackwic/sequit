import { describe, expect, it } from 'vitest';

import { EndpointKind, type LogicDocument } from '../../src/lib/document/logic-document';
import { mapSequitDocument } from '../../src/lib/text/map-sequit-document';

function root(): Record<string, unknown> {
	return {
		persistenceFormat: 2,
		document: { id: 'ordering', title: 'Ordering' },
		layout: { direction: 'top-to-bottom', bias: 'top' },
		natures: { goal: { label: 'Goal', color: '#00aa44' } },
		groups: {},
		nodes: {
			z: { nature: 'goal', markdown: 'Z', layoutOrder: 'a1' },
			a: { nature: 'goal', markdown: 'A', layoutOrder: 'a0' },
		},
		junctions: {},
		relations: {},
	};
}

function mapped(value: unknown): LogicDocument {
	const result = mapSequitDocument(value);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('Expected mapping to succeed');
	return result.value;
}

describe('mapSequitDocument endpoint order', () => {
	it('rejects a non-table root without attempting field mapping', () => {
		expect(mapSequitDocument(null)).toEqual({
			ok: false,
			diagnostics: [{ code: 'invalid-type', message: ' must be a table', path: [] }],
		});
	});

	it('diagnoses missing collection tables and document fields', () => {
		const result = mapSequitDocument({ persistenceFormat: 2 });
		expect(result).toEqual({
			ok: false,
			diagnostics: [
				'document',
				'layout',
				'natures',
				'groups',
				'nodes',
				'junctions',
				'relations',
			].map((field) => ({
				code: 'missing-field',
				message: `${field} must be a table`,
				path: [field],
			})),
		});
	});

	it.each(['id', 'title'] as const)('requires the document %s independently', (field) => {
		const value = root();
		if (field === 'id') value['document'] = { title: 'Ordering' };
		else value['document'] = { id: 'ordering' };
		const result = mapSequitDocument(value);
		expect(result).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'missing-field',
					message: `document.${field} must be a string`,
					path: ['document', field],
				},
			],
		});
	});

	it('diagnoses malformed and incomplete entities in every collection', () => {
		const value = root();
		value['natures'] = {
			malformed: false,
			incomplete: { label: 'Incomplete' },
		};
		value['groups'] = {
			malformed: false,
			incomplete: { label: 'Incomplete', layoutOrder: false },
		};
		value['nodes'] = {
			malformed: false,
			incomplete: { nature: 'goal', markdown: false, layoutOrder: 'a0' },
		};
		value['junctions'] = {
			malformed: false,
			unsupported: { operator: 'and', layoutOrder: 'a0' },
		};
		value['relations'] = {
			malformed: false,
			incomplete: { from: 'source' },
		};

		const result = mapSequitDocument(value);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected malformed entities to fail');
		expect(result.diagnostics).toContainEqual({
			code: 'invalid-value',
			message: 'Unsupported junction operator: and',
			path: ['junctions', 'unsupported', 'operator'],
		});
		expect(
			result.diagnostics.filter(({ message }) => message.endsWith('must be a table')),
		).toHaveLength(5);
	});
	it('rejects the previous portable format before validating endpoint keys', () => {
		const value = root();
		value['persistenceFormat'] = 1;

		expect(mapSequitDocument(value)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'unsupported-persistence-format',
					message: 'Unsupported persistenceFormat: 1',
					path: ['persistenceFormat'],
				},
			],
		});
	});

	it('is independent of source table declaration order', () => {
		const original = root();
		const reordered = Object.fromEntries(Object.entries(original).reverse());
		expect(mapped(reordered)).toEqual(mapped(original));
	});

	it('maps node, group, and junction layoutOrder fields with enum kinds', () => {
		const value = root();
		value['groups'] = { group: { label: 'Group', layoutOrder: 'a0' } };
		value['nodes'] = { node: { nature: 'goal', markdown: 'Node', layoutOrder: 'a1' } };
		value['junctions'] = { choice: { operator: 'xor', layoutOrder: 'a2' } };
		const document = mapped(value);
		expect(document.groups).toEqual([
			{ kind: EndpointKind.Group, id: 'group', label: 'Group', layoutOrder: 'a0' },
		]);
		expect(document.nodes).toEqual([
			{
				kind: EndpointKind.Node,
				id: 'node',
				natureId: 'goal',
				markdown: 'Node',
				layoutOrder: 'a1',
			},
		]);
		expect(document.junctions).toEqual([
			{ kind: EndpointKind.Junction, id: 'choice', operator: 'xor', layoutOrder: 'a2' },
		]);
	});

	it('diagnoses malformed endpoint-local order keys at the entity path', () => {
		const value = root();
		value['nodes'] = {
			z: { nature: 'goal', markdown: 'Z', layoutOrder: 'not a key' },
			a: { nature: 'goal', markdown: 'A' },
		};
		const result = mapSequitDocument(value);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected malformed layout order to fail');
		expect(result.diagnostics).toContainEqual({
			code: 'invalid-value',
			message: 'nodes.z.layoutOrder must be a valid fractional order key',
			path: ['nodes', 'z', 'layoutOrder'],
		});
	});

	it('diagnoses unsupported and direction-incompatible layout biases', () => {
		const unsupported = root();
		unsupported['layout'] = { direction: 'top-to-bottom', bias: 'diagonal' };
		expect(mapSequitDocument(unsupported)).toEqual({
			ok: false,
			diagnostics: [
				{
					code: 'invalid-value',
					message: 'Unsupported layout bias: diagonal',
					path: ['layout', 'bias'],
				},
			],
		});

		const incompatible = root();
		incompatible['layout'] = { direction: 'top-to-bottom', bias: 'left' };
		const result = mapSequitDocument(incompatible);
		expect(result).toMatchObject({ ok: false });
		if (result.ok) throw new Error('Expected incompatible layout to fail');
		expect(result.diagnostics).toContainEqual({
			code: 'invalid-value',
			message: 'Layout bias left is incompatible with direction top-to-bottom',
			path: ['layout', 'bias'],
		});
	});

	it('diagnoses a junction with a missing operator', () => {
		const value = root();
		value['junctions'] = { incomplete: { layoutOrder: 'a0' } };
		expect(mapSequitDocument(value)).toMatchObject({ ok: false });
	});

	it.each([
		['groups', 'group', { label: 'Group' }],
		['nodes', 'node', { nature: 'goal', markdown: 'Node' }],
		['junctions', 'choice', { operator: 'xor' }],
	] as const)(
		'rejects keyless %s data in the current portable format',
		(collection, id, endpoint) => {
			const value = root();
			value[collection] = { [id]: endpoint };
			const result = mapSequitDocument(value);
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error('Expected missing layout order to fail');
			expect(result.diagnostics).toContainEqual({
				code: 'missing-field',
				message: `${collection}.${id}.layoutOrder must be a string`,
				path: [collection, id, 'layoutOrder'],
			});
		},
	);
});

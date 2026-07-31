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

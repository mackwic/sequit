import { describe, expect, it } from 'vitest';

import { EndpointKind } from '../../../../src/lib/core/document/logic-document';
import { groupSiblingDocumentNodes } from '../../../../src/lib/infrastructure/document/document-group-operations';
import { validLogicDocument } from '../../../support/builders/logic-document';

describe('product node grouping', () => {
	it('creates a root group around root siblings', () => {
		const grouped = groupSiblingDocumentNodes(
			validLogicDocument(),
			{ id: 'root-group', label: 'Groupe' },
			new Set(['target', 'isolated']),
		);

		expect(grouped.groups).toContainEqual(
			expect.objectContaining({
				kind: EndpointKind.Group,
				id: 'root-group',
				label: 'Groupe',
			}),
		);
		expect(grouped.groups.find(({ id }) => id === 'root-group')).not.toHaveProperty('groupId');
		expect(
			grouped.nodes
				.filter(({ id }) => id === 'target' || id === 'isolated')
				.map(({ groupId }) => groupId),
		).toEqual(['root-group', 'root-group']);
	});

	it('nests the new group when every selected node has the same parent', () => {
		const grouped = groupSiblingDocumentNodes(
			validLogicDocument(),
			{ id: 'nested-group', label: 'Groupe' },
			new Set(['source-a', 'source-b']),
		);

		expect(grouped.groups.find(({ id }) => id === 'nested-group')).toMatchObject({
			groupId: 'container',
		});
	});

	it.each([
		['an empty selection', 'candidate', new Set<string>(), 'Sélectionnez les nœuds à regrouper.'],
		['a missing node', 'candidate', new Set(['missing']), 'Nœud introuvable : missing'],
		[
			'mixed parents',
			'candidate',
			new Set(['source-a', 'target']),
			'Les nœuds doivent appartenir au même groupe.',
		],
		['a duplicate id', 'container', new Set(['target']), 'Cet identifiant existe déjà : container'],
	] as const)('rejects %s', (_name, id, ids, message) => {
		expect(() =>
			groupSiblingDocumentNodes(validLogicDocument(), { id, label: 'Groupe' }, ids),
		).toThrow(message);
	});
});

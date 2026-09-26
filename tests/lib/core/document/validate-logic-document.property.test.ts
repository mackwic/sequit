import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { EndpointKind, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { validLogicDocument } from '../../../support/builders/logic-document';
import {
	cyclicGroupLogicDocumentArbitrary,
	duplicateEndpointLogicDocumentArbitrary,
	groupId,
	richAcyclicLogicDocumentArbitrary,
	unknownGroupLogicDocumentArbitrary,
	unknownNatureLogicDocumentArbitrary,
} from '../../../support/builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

function diagnosticCodes(document: Parameters<typeof validateLogicDocument>[0]): readonly string[] {
	const result = validateLogicDocument(document);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('Expected an invalid generated document');
	return result.diagnostics.map(({ code }) => code);
}

describe('generated logic document validation', () => {
	it('validates deeply nested acyclic groups without exhausting the call stack', () => {
		const depth = 15_000;
		const groups = Array.from({ length: depth }, (_, index) => {
			const group = {
				kind: EndpointKind.Group as const,
				id: `group-${index}`,
				label: '',
				layoutOrder: orderKey('a0'),
			};
			if (index + 1 >= depth) return group;
			return { ...group, groupId: `group-${index + 1}` };
		});
		const document: LogicDocument = {
			...validLogicDocument(),
			groups,
			nodes: [],
			junctions: [],
			relations: [],
		};

		expect(validateLogicDocument(document)).toEqual({ ok: true, value: document });
	});

	it('reports a cycle at the end of deeply nested groups without exhausting the call stack', () => {
		const depth = 15_000;
		const groups = Array.from({ length: depth }, (_, index) => {
			let parentId = `group-${depth - 2}`;
			if (index + 1 < depth) parentId = `group-${index + 1}`;
			return {
				kind: EndpointKind.Group as const,
				id: `group-${index}`,
				label: '',
				groupId: parentId,
				layoutOrder: orderKey('a0'),
			};
		});
		const base = validLogicDocument();
		const result = validateLogicDocument({
			...base,
			groups,
			nodes: [],
			junctions: [],
			relations: [],
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected a group cycle');
		expect(result.diagnostics).toContainEqual({
			code: 'group-cycle',
			message: `Group nesting cycle: group-${depth - 2} -> group-${depth - 1} -> group-${depth - 2}`,
			path: ['groups', `group-${depth - 1}`, 'group'],
		});
	});

	it('accepts rich documents with nested and empty endpoint groups, junctions and heterogeneous relations', () => {
		fc.assert(
			fc.property(richAcyclicLogicDocumentArbitrary(), (document) => {
				expect(validateLogicDocument(document)).toEqual({ ok: true, value: document });
				expect(document.groups).toContainEqual(
					expect.objectContaining({ id: groupId(1), groupId: groupId(0) }),
				);
				const emptyGroup = document.groups.find(({ id }) => id === groupId(2));
				expect(emptyGroup).toBeDefined();
				expect(
					[...document.groups, ...document.nodes, ...document.junctions].some(
						({ groupId: parentId }) => parentId === groupId(2),
					),
				).toBe(false);
				expect(document.junctions.length).toBeGreaterThan(0);
				const endpointKindById = new Map([
					...document.groups.map(({ id }) => [id, 'group'] as const),
					...document.nodes.map(({ id }) => [id, 'node'] as const),
					...document.junctions.map(({ id }) => [id, 'junction'] as const),
				]);
				const transitions = new Set(
					document.relations.map(
						({ from, to }) => `${endpointKindById.get(from)}:${endpointKindById.get(to)}`,
					),
				);
				expect(transitions).toContain('node:junction');
				expect(transitions).toContain('junction:group');
				expect(transitions).toContain('group:node');
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects endpoint identifiers duplicated across collections', () => {
		fc.assert(
			fc.property(duplicateEndpointLogicDocumentArbitrary, (document) => {
				expect(diagnosticCodes(document)).toContain('duplicate-endpoint-id');
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects nodes whose nature is unknown', () => {
		fc.assert(
			fc.property(unknownNatureLogicDocumentArbitrary, (document) => {
				expect(diagnosticCodes(document)).toContain('unknown-nature');
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects unknown parent groups on every groupable endpoint kind', () => {
		fc.assert(
			fc.property(unknownGroupLogicDocumentArbitrary, (document) => {
				expect(diagnosticCodes(document)).toContain('unknown-group');
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects every generated group containment cycle', () => {
		fc.assert(
			fc.property(cyclicGroupLogicDocumentArbitrary, (document) => {
				expect(diagnosticCodes(document)).toContain('group-cycle');
			}),
			PROPERTY_PARAMETERS,
		);
	});
});

import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	GroupState,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { serializeLogicDocumentDot } from '../../../../src/lib/infrastructure/dot/serialize-logic-document-dot';
import { validLogicDocument } from '../../../support/builders/logic-document';

describe('DOT export', () => {
	it('emits every logical endpoint and relation with their stable identities and direction', () => {
		const dot = serializeLogicDocumentDot(validLogicDocument());

		expect(dot).toContain('digraph "valid-document" {');
		expect(dot).toContain('graph [label="Valid document", rankdir=TB];');
		expect(dot).toContain('subgraph "cluster_container" {');
		expect(dot).toContain('"container" [label="Container", shape=folder];');
		expect(dot).toContain('"source-a" [label="Source A\\n", color="#00aa44"];');
		expect(dot).toContain('"choice" [label="XOR", shape=circle];');
		expect(dot).toContain('"isolated" [label="Isolated\\n", color="#00aa44"];');
		expect(dot).toContain('"source-a" -> "choice" [id="a-to-choice"];');
		expect(dot).toContain('"endpoint-group" -> "target" [id="group-to-target"];');
		expect(dot).not.toContain('"choice" -> "source-a"');
	});

	it('nests groups, keeps descendants of closed groups, and uses node and group colors', () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			groups: [
				...base.groups.map((group) => {
					if (group.id === 'container')
						return { ...group, color: '#abc', state: GroupState.Closed };
					return group;
				}),
				{
					kind: EndpointKind.Group,
					id: 'nested',
					label: 'Nested',
					groupId: 'container',
					layoutOrder: orderKey('a8'),
				},
			],
			nodes: base.nodes.map((node) => {
				if (node.id === 'source-a') return { ...node, groupId: 'nested', color: '#123456' };
				return node;
			}),
		};
		const dot = serializeLogicDocumentDot(document);

		expect(dot).toContain('  subgraph "cluster_container" {\n    label="";\n    color="#abc";');
		expect(dot).toContain('    subgraph "cluster_nested" {');
		expect(dot).toContain('      "source-a" [label="Source A\\n", color="#123456"];');
		expect(dot).toContain('"source-a" -> "choice" [id="a-to-choice"];');
	});

	it.each([
		[LayoutDirection.TopToBottom, 'BT'],
		[LayoutDirection.BottomToTop, 'TB'],
		[LayoutDirection.LeftToRight, 'RL'],
		[LayoutDirection.RightToLeft, 'LR'],
	])('maps %s to rankdir=%s without reversing edges', (direction, rankdir) => {
		const base = validLogicDocument();
		let bias: LayoutBias = LayoutBias.Top;
		if (direction === LayoutDirection.LeftToRight || direction === LayoutDirection.RightToLeft)
			bias = LayoutBias.Left;
		const layout = layoutConfiguration(direction, bias);
		if (layout === undefined) throw new Error('Expected a valid layout configuration');
		const document: LogicDocument = { ...base, layout };
		const dot = serializeLogicDocumentDot(document);

		expect(dot).toContain(`rankdir=${rankdir}`);
		expect(dot).toContain('"source-a" -> "choice" [id="a-to-choice"];');
	});

	it('quotes user controlled text and identifiers without creating extra DOT statements', () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			id: 'a" -> "b',
			title: 'Title";\n"forged" -> "target',
			nodes: base.nodes.map((node) => {
				if (node.id === 'source-a')
					return { ...node, id: 'source"a', markdown: 'One "quote"\nTwo \\N' };
				return node;
			}),
			relations: base.relations.map((relation) => {
				if (relation.from === 'source-a') return { ...relation, from: 'source"a' };
				return relation;
			}),
		};
		const dot = serializeLogicDocumentDot(document);

		expect(dot).toContain('digraph "a\\" -> \\"b" {');
		expect(dot).toContain('label="Title\\";\\n\\"forged\\" -> \\"target"');
		expect(dot).toContain('"source\\"a" [label="One \\"quote\\"\\nTwo \\\\N"');
		expect(dot).toContain('"source\\"a" -> "choice"');
		expect(dot).not.toContain('\n"forged" -> "target');
	});

	it('rejects duplicate relation identities', () => {
		const document = validLogicDocument();
		const firstRelation = document.relations[0];
		if (firstRelation === undefined) throw new Error('Expected a relation in the fixture');
		expect(() =>
			serializeLogicDocumentDot({
				...document,
				relations: [...document.relations, firstRelation],
			}),
		).toThrow('Duplicate relation IDs');
	});
});

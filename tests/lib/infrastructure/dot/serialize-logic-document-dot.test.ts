// @vitest-environment jsdom
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

function cardTable(dot: string, id: string): HTMLTableElement {
	const line = dot
		.split('\n')
		.find((candidate) => candidate.trimStart().startsWith(`${JSON.stringify(id)} [`));
	const label = /label=<(.*)>/.exec(line ?? '')?.[1];
	if (label === undefined) throw new Error(`Missing HTML card for ${id}`);
	const template = document.createElement('template');
	template.innerHTML = label;
	const table = template.content.querySelector('table');
	if (table === null) throw new Error(`Missing table for ${id}`);
	return table;
}

describe('DOT export', () => {
	it('renders a custom document nature without treating its label as markup', () => {
		const nature = { id: 'custom', label: 'Sur mesure & <test>', color: '#123456' };
		const base = validLogicDocument();
		const dot = serializeLogicDocumentDot({
			...base,
			natures: [nature],
			nodes: base.nodes.map((node) => ({ ...node, natureId: nature.id })),
		});
		const table = cardTable(dot, 'source-a');
		expect(table.rows[0]?.textContent).toBe(nature.label);
		expect(table.rows[1]?.textContent).toBe('Source A');
	});

	it('uses a node color override for both its pastel header and border', () => {
		const base = validLogicDocument();
		const dot = serializeLogicDocumentDot({
			...base,
			nodes: base.nodes.map((node) => ({ ...node, color: '#123456' })),
		});
		const table = cardTable(dot, 'source-a');
		expect(table.rows[0]?.cells[0]?.getAttribute('bgcolor')).toBe('#e0e5e9');
		expect(table.getAttribute('color')).toBe('#919ba6');
		expect(table.rows[0]?.textContent).toBe('Goal');
	});

	it('emits every logical endpoint and relation with their stable identities and direction', () => {
		const dot = serializeLogicDocumentDot(validLogicDocument());

		expect(dot).toContain('digraph "valid-document" {');
		expect(dot).toContain('label="Valid document"');
		expect(dot).toContain('subgraph "cluster_container" {');
		expect(cardTable(dot, 'source-a').rows[1]?.textContent).toBe('Source A');
		expect(dot).toContain('"choice" [label="XOR", shape=circle];');
		expect(cardTable(dot, 'isolated').rows[1]?.textContent).toBe('Isolated');
		expect(dot).toContain('"source-a" -> "choice" [id="a-to-choice"];');
		expect(dot).toContain(
			'"endpoint-group" -> "target" [id="group-to-target", ltail="cluster_endpoint-group"];',
		);
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

		expect(dot).toContain('label="Container"');
		expect(dot).toContain('color="#abc"');
		expect(dot).toContain('    subgraph "cluster_nested" {');
		expect(cardTable(dot, 'source-a').rows[1]?.textContent).toBe('Source A');
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
		expect(cardTable(dot, 'source"a').rows[1]?.textContent).toBe('One "quote"Two \\\\N');
		expect(cardTable(dot, 'source"a').querySelectorAll('br')).toHaveLength(1);
		expect(dot).toContain('"source\\"a" -> "choice"');
		expect(dot).not.toContain('\n"forged" -> "target');
	});

	it('projects supported Markdown and escaped punctuation into readable multiline text', () => {
		const base = validLogicDocument();
		const dot = serializeLogicDocumentDot({
			...base,
			nodes: base.nodes.map((node) => ({
				...node,
				markdown: 'idea \\! **bold** *italic* <u>underlined</u>\n\nsecond',
			})),
		});
		const body = cardTable(dot, 'source-a').rows[1];
		expect(body?.textContent).toBe('idea ! bold italic underlinedsecond');
		expect(body?.querySelectorAll('br')).toHaveLength(2);
	});

	it('keeps unsupported HTML as literal text, not Graphviz label structure', () => {
		const base = validLogicDocument();
		const markdown = '<TABLE><TR><TD>forged & "quoted"</TD></TR></TABLE>';
		const dot = serializeLogicDocumentDot({
			...base,
			nodes: base.nodes.map((node) => ({ ...node, markdown })),
		});
		const body = cardTable(dot, 'source-a').rows[1];
		expect(body?.textContent).toBe(markdown);
		expect(body?.querySelector('table')).toBeNull();
	});

	it('clips group relations to the frame only when the opposite endpoint is outside it', () => {
		const base = validLogicDocument();
		const dot = serializeLogicDocumentDot({
			...base,
			relations: [
				{ id: 'incoming', from: 'target', to: 'container' },
				{ id: 'internal', from: 'container', to: 'source-a' },
				{ id: 'outgoing', from: 'container', to: 'target' },
			],
		});
		expect(dot).toContain('"target" -> "container" [id="incoming", lhead="cluster_container"];');
		expect(dot).toContain('"container" -> "source-a" [id="internal"];');
		expect(dot).toContain('"container" -> "target" [id="outgoing", ltail="cluster_container"];');
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

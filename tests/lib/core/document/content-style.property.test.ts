import fc from 'fast-check';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createCanvasMeasurementModel } from '../../../../src/app/web/ui/canvas/canvas-model';
import { contentPalette } from '../../../../src/app/web/ui/content/content-palette';
import { iconUrl } from '../../../../src/app/web/ui/icons/phosphor';
import { phosphorIcons } from '../../../../src/app/web/ui/icons/phosphor-catalogue';
import { WorkshopDocument } from '../../../../src/app/workshop/runtime/workshop-document';
import { duplicateWorkshopNodes } from '../../../../src/app/workshop/runtime/workshop-node-operations';
import {
	styleDocumentNature,
	styleDocumentNode,
} from '../../../../src/lib/core/document/content-style';
import {
	contentStyleFields,
	defined,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { mapSequitDocument } from '../../../../src/lib/infrastructure/toml/map-sequit-document';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

const colorArbitrary = fc.option(
	fc.integer({ min: 0, max: 0xffffff }).map((value) => `#${value.toString(16).padStart(6, '0')}`),
	{ nil: undefined },
);
const iconArbitrary = fc.option(
	fc.constantFrom('none', 'phosphor:scales', 'phosphor:lightning', 'custom-library:my-symbol'),
	{ nil: undefined },
);
const styleArbitrary = fc
	.tuple(colorArbitrary, iconArbitrary)
	.map(([color, icon]) => contentStyleFields(color, icon));

function readable(document: Y.Doc): LogicDocument {
	const result = readLogicDocument(document);
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	return result.value;
}

describe('content style contracts', () => {
	it('round trips inherited and explicit styles without changing graph identity, membership or ordering', () => {
		fc.assert(
			fc.property(styleArbitrary, styleArbitrary, (nodeStyle, natureStyle) => {
				const original = validLogicDocument();
				const withNature = styleDocumentNature(original, 'goal', natureStyle);
				const styled = styleDocumentNode(withNature, 'source-a', nodeStyle);
				expect(styled.groups).toBe(original.groups);
				expect(styled.relations).toBe(original.relations);
				expect(styled.junctions).toBe(original.junctions);
				expect(styled.layout).toBe(original.layout);
				const text = serializeSequitToml(styled);
				const parsed = parseSequitToml(text);
				expect(parsed.ok).toBe(true);
				if (!parsed.ok) throw new Error('Invalid style round trip');
				expect(serializeSequitToml(parsed.value)).toBe(text);
				expect(parsed.value.nodes.find((node) => node.id === 'source-a')).toEqual(styled.nodes[0]);
				const ydoc = new Y.Doc();
				try {
					importLogicDocument(ydoc, styled);
					expect(serializeSequitToml(readable(ydoc))).toBe(text);
				} finally {
					ydoc.destroy();
				}
				const reset = styleDocumentNode(styled, 'source-a', {});
				expect(reset.nodes).toEqual(original.nodes);
				expect(original.natures).toEqual(validLogicDocument().natures);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps style edits, undo, duplication, text edits and export on the same live source', async () => {
		const store = new WorkshopDocument(serializeSequitToml(validLogicDocument()));
		try {
			const before = store.text();
			store.edit((current) =>
				styleDocumentNode(current, 'source-a', { color: '#fed', icon: 'none' }),
			);
			const styled = store.text();
			store.history.undo();
			expect(store.text()).toBe(before);
			store.history.redo();
			expect(store.text()).toBe(styled);
			store.edit((current) =>
				duplicateWorkshopNodes(current, [{ sourceId: 'source-a', id: 'copy' }]),
			);
			expect(store.node('copy')).toMatchObject({
				color: '#fed',
				icon: 'none',
				markdown: 'Source A\n',
			});
			await store.opened.replaceNodeMarkdown('copy', 'Edited copy');
			expect(store.node('copy')).toMatchObject({
				color: '#fed',
				icon: 'none',
				markdown: 'Edited copy',
			});
			expect(store.opened.measurementModel.nodes.find((node) => node.id === 'copy')).toMatchObject({
				color: '#fed',
				icon: 'none',
			});
			store.edit((current) => styleDocumentNode(current, 'copy', {}));
			expect(store.node('copy')).not.toHaveProperty('color');
			expect(store.node('copy')).not.toHaveProperty('icon');
			store.import(styled);
			expect(store.text()).toBe(styled);
			await store.opened.addNode({
				id: 'command-node',
				natureId: 'goal',
				markdown: 'Created through the product command',
				color: '#345678',
				icon: 'phosphor:scales',
			});
			expect(store.node('command-node')).toMatchObject({
				color: '#345678',
				icon: 'phosphor:scales',
			});
		} finally {
			store.destroy();
		}
	});

	it('merges independent nature and node changes across replicas without flattening inheritance', () => {
		const alice = new Y.Doc();
		const bob = new Y.Doc();
		try {
			importLogicDocument(alice, validLogicDocument());
			Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
			defined(alice.getMap<Y.Map<unknown>>(YjsCollection.Natures).get('goal')).set(
				'icon',
				'phosphor:target',
			);
			defined(bob.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-a')).set(
				'color',
				'#b91c1c',
			);
			Y.applyUpdate(alice, Y.encodeStateAsUpdate(bob));
			Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));
			expect(readable(alice)).toEqual(readable(bob));
			const projected = createCanvasMeasurementModel(readable(alice));
			expect(projected.nodes.find((node) => node.id === 'source-a')).toMatchObject({
				color: '#b91c1c',
				nature: { color: '#00aa44', icon: 'phosphor:target' },
			});
			expect(projected.nodes.find((node) => node.id === 'source-b')).not.toHaveProperty('color');
		} finally {
			alice.destroy();
			bob.destroy();
		}
	});

	it('does not silently apply style changes to missing entities', () => {
		expect(() => styleDocumentNode(validLogicDocument(), 'missing', {})).toThrow('Unknown node');
		expect(() => styleDocumentNature(validLogicDocument(), 'missing', {})).toThrow(
			'Unknown nature',
		);
	});

	for (const [field, invalid] of [
		['color', 'red'],
		['color', '#ffff'],
		['icon', 'https://example.com/icon.svg'],
		['icon', '<svg>'],
		['icon', `pack:${'x'.repeat(128)}`],
	] as const) {
		it(`rejects malformed ${field}: ${invalid}`, () => {
			const document = styleDocumentNode(validLogicDocument(), 'source-a', { [field]: invalid });
			expect(validateLogicDocument(document)).toMatchObject({
				ok: false,
				diagnostics: [{ path: ['nodes', 'source-a', field] }],
			});
			expect(parseSequitToml(serializeSequitToml(document)).ok).toBe(false);
		});
	}

	for (const collection of ['nodes', 'natures'] as const) {
		for (const field of ['color', 'icon'] as const) {
			it(`diagnoses invalid ${collection}.${field} field types in TOML and Yjs`, () => {
				let id = 'source-a';
				let shared = YjsCollection.Nodes;
				if (collection === 'natures') {
					id = 'goal';
					shared = YjsCollection.Natures;
				}
				const root = parse(serializeSequitToml(validLogicDocument()));
				const entities: unknown = root[collection];
				if (typeof entities !== 'object' || entities === null)
					throw new Error('Missing collection');
				const entity: unknown = Reflect.get(entities, id);
				if (typeof entity !== 'object' || entity === null) throw new Error('Missing entity');
				Reflect.set(entity, field, 42);
				const result = mapSequitDocument(root);
				expect(result.ok).toBe(false);
				if (result.ok) throw new Error('Expected invalid field type');
				expect(result.diagnostics.map((item) => item.path)).toContainEqual([collection, id, field]);
				const ydoc = new Y.Doc();
				try {
					importLogicDocument(ydoc, validLogicDocument());
					defined(ydoc.getMap<Y.Map<unknown>>(shared).get(id)).set(field, 42);
					expect(readLogicDocument(ydoc).ok).toBe(false);
				} finally {
					ydoc.destroy();
				}
			});
		}
	}

	it('ships distinct valid color choices and resolves bundled Phosphor references only', () => {
		const colors = contentPalette.flatMap((family) => [...family.colors]);
		expect(new Set(colors).size).toBe(54);
		for (const color of colors)
			expect(
				validateLogicDocument(styleDocumentNature(validLogicDocument(), 'goal', { color })).ok,
			).toBe(true);
		expect(phosphorIcons.length).toBeGreaterThan(1000);
		for (const icon of phosphorIcons) expect(iconUrl(icon.id)).toBeDefined();
		expect(iconUrl('none')).toBeUndefined();
		expect(iconUrl('custom-library:my-symbol')).toBeUndefined();
		expect(iconUrl('https://example.com/icon.svg')).toBeUndefined();
	});
});

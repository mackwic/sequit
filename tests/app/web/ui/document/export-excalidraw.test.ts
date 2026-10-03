import { describe, expect, it } from 'vitest';

import { createSharedCanvasProjection } from '../../../../../src/app/web/projection/open-document';
import type { CanvasModel } from '../../../../../src/app/web/ui/canvas/canvas-model';
import { serializeExcalidraw } from '../../../../../src/app/web/ui/document/export-excalidraw';
import {
	EndpointKind,
	GroupState,
	JunctionOperator,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import { layoutMeasurementsForCanvas } from '../../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../../support/builders/logic-document';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../../support/fixtures/collaborative-document';

interface ExportedElement {
	readonly id: string;
	readonly type: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly strokeColor: string;
	readonly backgroundColor: string;
	readonly roundness: null | { readonly type: number };
	readonly text?: string;
	readonly points?: readonly (readonly [number, number])[];
	readonly groupIds: readonly string[];
	readonly startBinding?: { readonly elementId: string; readonly fixedPoint: readonly number[] };
	readonly endBinding?: { readonly elementId: string; readonly fixedPoint: readonly number[] };
	readonly boundElements: readonly { readonly id: string; readonly type: string }[];
}

interface ExportedScene {
	readonly type: string;
	readonly version: number;
	readonly elements: readonly ExportedElement[];
	readonly appState: { readonly name: string; readonly viewBackgroundColor: string };
	readonly files: Record<string, unknown>;
}

function elementId(...parts: readonly string[]): string {
	return `sequit:${JSON.stringify(parts)}`;
}

function isScene(value: unknown): value is ExportedScene {
	if (typeof value !== 'object' || value === null) return false;
	if (!('elements' in value) || !Array.isArray(value.elements)) return false;
	if (!('appState' in value) || typeof value.appState !== 'object') return false;
	return value.elements.every((entry: unknown) => {
		if (typeof entry !== 'object' || entry === null) return false;
		return 'id' in entry && typeof entry.id === 'string';
	});
}

function parseScene(serialized: string): ExportedScene {
	const parsed: unknown = JSON.parse(serialized);
	if (!isScene(parsed)) throw new Error('Invalid Excalidraw scene');
	return parsed;
}

function sceneFor(document: LogicDocument, canvas: CanvasModel): ExportedScene {
	return parseScene(serializeExcalidraw(document, canvas));
}

function element(scene: ExportedScene, ...parts: readonly string[]): ExportedElement {
	const id = elementId(...parts);
	const found = scene.elements.find((entry) => entry.id === id);
	if (found === undefined) throw new Error(`Missing Excalidraw element ${id}`);
	return found;
}

describe('Excalidraw export', () => {
	it('uses the real canvas projection and preserves its editable boxes and routed arrows', async () => {
		const document = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'export');
		const projection = createSharedCanvasProjection(document);
		const canvas = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		const serialized = serializeExcalidraw(document, canvas);
		const scene = parseScene(serialized);
		expect(serializeExcalidraw(document, canvas)).toBe(serialized);
		expect(scene).toMatchObject({
			type: 'excalidraw',
			version: 2,
			appState: { name: document.title, viewBackgroundColor: '#ffffff' },
			files: {},
		});
		const allIds = scene.elements.map(({ id }) => id);
		expect(new Set(allIds).size).toBe(allIds.length);
		for (const node of canvas.nodes) {
			expect(element(scene, 'endpoint', node.id)).toMatchObject({
				type: 'rectangle',
				...node.bounds,
				roundness: { type: 3 },
				strokeColor: '#8bc5a0',
			});
			expect(element(scene, 'node-header', node.id)).toMatchObject({
				type: 'rectangle',
				backgroundColor: '#def4e7',
			});
			expect(element(scene, 'node-body', node.id).text).toBe(node.markdown);
		}
		for (const relation of canvas.relations) {
			const arrow = element(scene, 'relation', relation.id);
			expect(arrow.type).toBe('arrow');
			expect(arrow.points?.map(([x, y]) => ({ x: x + arrow.x, y: y + arrow.y }))).toEqual(
				relation.points,
			);
			expect(arrow.startBinding?.elementId).toBe(elementId('endpoint', relation.from));
			expect(arrow.endBinding?.elementId).toBe(elementId('endpoint', relation.to));
			expect(element(scene, 'endpoint', relation.from).boundElements).toContainEqual({
				id: arrow.id,
				type: 'arrow',
			});
		}
	});

	it('exports nested groups, markdown text, junctions, and regional lanes as separate shapes', () => {
		const original = validLogicDocument();
		const nature = original.natures[0];
		if (nature === undefined) throw new Error('Expected a nature');
		const document: LogicDocument = {
			...original,
			groups: [
				{ kind: EndpointKind.Group, id: 'outer', label: 'Outer', layoutOrder: orderKey('a0') },
				{
					kind: EndpointKind.Group,
					id: 'inner',
					label: 'Inner',
					groupId: 'outer',
					layoutOrder: orderKey('a1'),
				},
			],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'from',
					natureId: nature.id,
					groupId: 'inner',
					color: '#369',
					markdown: 'Hello **world**\nagain',
					layoutOrder: orderKey('a2'),
				},
				{
					kind: EndpointKind.Node,
					id: 'to',
					natureId: nature.id,
					markdown: 'Target',
					layoutOrder: orderKey('a3'),
				},
			],
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'choice',
					operator: JunctionOperator.Or,
					groupId: 'outer',
					layoutOrder: orderKey('a4'),
				},
			],
			relations: [{ id: 'route', from: 'from', to: 'to' }],
		};
		const canvas: CanvasModel = {
			width: 600,
			height: 400,
			regions: [{ id: 'zone', label: 'Zone', bounds: { x: 10, y: 10, width: 570, height: 370 } }],
			lanes: [
				{
					id: 'lane',
					label: 'Lane',
					regionId: 'zone',
					bounds: { x: 20, y: 20, width: 550, height: 350 },
				},
			],
			groups: [
				{ id: 'inner', label: 'Inner', bounds: { x: 65, y: 65, width: 210, height: 160 } },
				{ id: 'outer', label: 'Outer', bounds: { x: 45, y: 45, width: 300, height: 250 } },
			],
			nodes: [
				{
					id: 'from',
					nature,
					color: '#369',
					markdown: 'Hello **world**\nagain',
					bounds: { x: 100, y: 100, width: 120, height: 80 },
				},
				{
					id: 'to',
					nature,
					markdown: 'Target',
					bounds: { x: 420, y: 160, width: 120, height: 80 },
				},
			],
			junctions: [
				{
					id: 'choice',
					operator: JunctionOperator.Or,
					bounds: { x: 280, y: 180, width: 20, height: 20 },
				},
			],
			relations: [
				{
					id: 'route',
					from: 'from',
					to: 'to',
					points: [
						{ x: 220, y: 140 },
						{ x: 300, y: 140 },
						{ x: 300, y: 200 },
						{ x: 420, y: 200 },
					],
				},
			],
		};
		const scene = sceneFor(document, canvas);
		expect(element(scene, 'endpoint', 'from')).toMatchObject({
			strokeColor: '#9dadbd',
			roundness: { type: 3 },
		});
		expect(element(scene, 'node-header', 'from').backgroundColor).toBe('#e4ebf2');
		expect(element(scene, 'node-header-bottom', 'from').roundness).toBeNull();
		expect(element(scene, 'node-header', 'to').backgroundColor).toBe('#def4e7');
		expect(element(scene, 'node-body', 'from').text).toBe('Hello world\nagain');
		expect(element(scene, 'endpoint', 'from').groupIds).toEqual([
			elementId('node-group', 'from'),
			elementId('group', 'inner'),
			elementId('group', 'outer'),
		]);
		expect(element(scene, 'endpoint', 'inner').groupIds).toEqual([
			elementId('group', 'inner'),
			elementId('group', 'outer'),
		]);
		expect(element(scene, 'endpoint', 'choice')).toMatchObject({ type: 'ellipse' });
		expect(element(scene, 'junction-label', 'choice').text).toBe('OR');
		expect(element(scene, 'region', 'zone')).toMatchObject({ type: 'rectangle', x: 10 });
		expect(element(scene, 'region-label', 'zone').height).toBe(18);
		expect(element(scene, 'lane', 'zone', 'lane')).toMatchObject({
			type: 'rectangle',
			x: 20,
		});
		expect(element(scene, 'group-label', 'outer').height).toBe(18);
		const arrow = element(scene, 'relation', 'route');
		expect(arrow).toMatchObject({
			type: 'arrow',
			x: 220,
			y: 140,
			width: 200,
			height: 60,
			points: [
				[0, 0],
				[80, 0],
				[80, 60],
				[200, 60],
			],
			startBinding: { elementId: elementId('endpoint', 'from'), fixedPoint: [1, 0.5] },
			endBinding: { elementId: elementId('endpoint', 'to'), fixedPoint: [0, 0.5] },
		});
	});

	it('exports only visible children of a folded group and binds its outgoing relation', async () => {
		const original = collaborativeFixture(CollaborativeFixture.OpenGroup, 'folded-export');
		const document: LogicDocument = {
			...original,
			groups: original.groups.map((group) => ({ ...group, state: GroupState.Closed })),
			nodes: [
				...original.nodes,
				{
					kind: EndpointKind.Node,
					id: 'external',
					natureId: 'N',
					markdown: 'External',
					layoutOrder: orderKey('a3'),
				},
			],
			relations: [{ id: 'outside', from: 'G', to: 'external' }],
		};
		const projection = createSharedCanvasProjection(document);
		const canvas = await projection.createCanvasModel(
			layoutMeasurementsForCanvas(projection.measurementModel),
		);
		expect(canvas.nodes.map(({ id }) => id)).toEqual(['external']);
		const scene = sceneFor(document, canvas);
		expect(scene.elements.some(({ id }) => id === elementId('endpoint', 'A'))).toBe(false);
		expect(scene.elements.some(({ id }) => id === elementId('endpoint', 'B'))).toBe(false);
		expect(element(scene, 'endpoint', 'G')).toMatchObject({ type: 'rectangle' });
		expect(element(scene, 'relation', 'outside').startBinding?.elementId).toBe(
			elementId('endpoint', 'G'),
		);
	});
});
